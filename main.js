// main.js - SISTEM BOOKING AONE VILLA DENGAN REAL-TIME AVAILABILITY
const SPREADSHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRPqWBMmttsUoeK05DQo6uh5x8K5MVTXiX-KLmQvb2Ohc2CMcyuLBdukJHrqihrBa1T4w9pqsuE6i95/pub?gid=98685081&single=true&output=csv';
const VILLA_PRICES = {
    'tulip': 2750000,      // Harga per malam
    'edelweiss': 2500000,
    'mahoni': 4500000
};
let allBookings = [];
let arrivalPicker, departurePicker;
let currentBookingData = {};

// ==================== DATE PARSING ====================
function parseDate(dateStr) {
    if (!dateStr) return null;
    
    dateStr = dateStr.toString().trim();
    
    // Format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return new Date(dateStr + 'T00:00:00');
    }
    
    // Format DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
        const parts = dateStr.split('/');
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    
    // Format lainnya
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    
    date.setHours(0, 0, 0, 0);
    return date;
}

// ==================== VALIDATION ====================
function validateDates(arrival, departure) {
    const arrivalDate = parseDate(arrival);
    const departureDate = parseDate(departure);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (!arrivalDate || !departureDate) {
        return "Format tanggal tidak valid";
    }
    
    // Check-in minimal harus BESOK
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (arrivalDate < tomorrow) {
        return "Check-in minimal 1 hari setelah booking (tidak bisa same-day check-in)";
    }
    
    if (departureDate <= arrivalDate) {
        return "Check-out harus setelah tanggal check-in";
    }
    
    const maxStay = 90;
    const diffTime = departureDate - arrivalDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > maxStay) {
        return `Maksimal menginap adalah ${maxStay} hari`;
    }
    
    return null;
}

// ==================== VILLA TYPE MAPPING ====================
function normalizeVillaType(villaTypeStr) {
    if (!villaTypeStr) return '';
    
    const villaType = villaTypeStr.toLowerCase();
    
    if (villaType.includes('tulip') || villaType.includes('1 bed') || villaType.includes('deluxe')) {
        return 'tulip';
    }
    if (villaType.includes('edelweiss') || villaType.includes('2 bed') || villaType.includes('family')) {
        return 'edelweiss';
    }
    if (villaType.includes('mahoni') || villaType.includes('3 bed') || villaType.includes('penthouse')) {
        return 'mahoni';
    }
    
    return villaType;
}

// ==================== CSV PARSING ====================
function parseCSV(csvText) {
    csvText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    
    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentCell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if (char === '\n' && !inQuotes) {
            currentRow.push(currentCell.trim());
            rows.push(currentRow);
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    
    if (currentCell !== '' || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
    }
    
    return rows;
}

// ==================== FETCH BOOKING DATA ====================
async function fetchAllBookings() {
    try {
        const timestamp = new Date().getTime();
        const url = `${SPREADSHEET_CSV_URL}&t=${timestamp}`;

        console.log('📥 Mengambil data booking dari spreadsheet...');
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const csvText = await response.text();
        
        if (!csvText || csvText.trim().length === 0) {
            console.warn('Data spreadsheet kosong');
            allBookings = [];
            updateCalendarWithBookedDates();
            return;
        }
        
        const rows = parseCSV(csvText);
        
        if (rows.length < 2) {
            console.warn('Tidak ada data ditemukan');
            allBookings = [];
            updateCalendarWithBookedDates();
            return;
        }
        
        // Cari indeks kolom
        let villaTypeIndex = -1;
        let checkInIndex = -1;
        let checkOutIndex = -1;
        let statusIndex = -1;

        const headers = rows[0].map(h => h.toLowerCase());
        headers.forEach((header, index) => {
            if (header.includes('villa') || header.includes('tipe')) villaTypeIndex = index;
            if (header.includes('checkin') || header.includes('check-in') || header.includes('masuk')) checkInIndex = index;
            if (header.includes('checkout') || header.includes('check-out') || header.includes('keluar')) checkOutIndex = index;
            if (header.includes('status') || header.includes('konfirmasi')) statusIndex = index;
        });

        if (statusIndex === -1) statusIndex = 9;

        console.log('📍 Kolom yang digunakan:');
        console.log(`Villa: ${villaTypeIndex}, Check-in: ${checkInIndex}, Check-out: ${checkOutIndex}, Status: ${statusIndex}`);
        
        allBookings = [];
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            if (row.every(cell => !cell || cell.trim() === '')) {
                continue;
            }
            
            const villaType = row[villaTypeIndex] || '';
            const checkIn = row[checkInIndex] || '';
            const checkOut = row[checkOutIndex] || '';
            const status = row[statusIndex] || '';
            
            if (!villaType || !checkIn || !checkOut) {
                continue;
            }
            
            const parsedCheckIn = parseDate(checkIn);
            const parsedCheckOut = parseDate(checkOut);
            
            if (!parsedCheckIn || !parsedCheckOut || parsedCheckOut <= parsedCheckIn) {
                continue;
            }
            
            const statusLower = status.toLowerCase();
            const statusTrimmed = status.trim();

            const isConfirmed = statusLower.includes('confirmed') || 
                  statusLower.includes('pending') ||
                  statusTrimmed === 'Pending' ||
                  statusTrimmed === 'pending';

            const isRejected = statusLower.includes('dibatalkan');
            
            if (!isConfirmed || isRejected) {
                continue;
            }
            
            allBookings.push({
                villaType: villaType.trim(),
                checkIn: checkIn.trim(),
                checkOut: checkOut.trim(),
                parsedCheckIn: parsedCheckIn,
                parsedCheckOut: parsedCheckOut
            });
        }
        
        console.log(`✅ Data booking ditemukan: ${allBookings.length} booking confirmed`);
        updateCalendarWithBookedDates();
        
    } catch (error) {
        console.error('❌ Error mengambil data booking:', error);
        allBookings = [];
    }
}

// ==================== GET BOOKED DATES ====================
function getBookedDatesForVilla(villaType) {
    console.log('📊 Getting booked dates for CHECK-IN only...');
    
    const blockedForCheckin = new Set(); // HANYA untuk check-in
    const normalizedTargetType = normalizeVillaType(villaType);
    
    console.log(`Villa: ${villaType} (normalized: ${normalizedTargetType})`);
    
    allBookings.forEach((booking, index) => {
        const normalizedBookingType = normalizeVillaType(booking.villaType);
        
        if (normalizedBookingType === normalizedTargetType) {
            const start = new Date(booking.parsedCheckIn);
            const end = new Date(booking.parsedCheckOut);
            
            if (!start || !end) return;
            
            console.log(`📅 Booking ${index + 1}: ${start.toDateString()} -> ${end.toDateString()}`);
            
            // HANYA blokir tanggal-tanggal untuk CHECK-IN
            // Check-in tidak boleh: [check-in existing] sampai [check-out existing - 1]
            let current = new Date(start);
            
            while (current < end) { // HANYA < (tidak termasuk check-out date)
                const dateStr = current.toISOString().split('T')[0];
                blockedForCheckin.add(dateStr);
                console.log(`    ❌ Tidak bisa CHECK-IN pada: ${dateStr}`);
                current.setDate(current.getDate() + 1);
            }
            
            // Check-out date TIDAK diblokir (bisa untuk check-in berikutnya)
            console.log(`    ✅ Bisa CHECK-IN pada: ${end.toISOString().split('T')[0]} (check-out date)`);
        }
    });
    
    const result = Array.from(blockedForCheckin).sort();
    console.log(`📋 Tanggal yang diblokir untuk CHECK-IN: ${result.length} tanggal`);
    return result;
}

// ==================== CHECK AVAILABILITY ====================
function checkVillaAvailability(villaType, checkin, checkout) {
    const checkinDate = parseDate(checkin);
    const checkoutDate = parseDate(checkout);
    const normalizedTargetType = normalizeVillaType(villaType);
    
    if (!checkinDate || !checkoutDate) {
        return { available: false, conflictDates: [], conflictBookings: [] };
    }
    
    console.log(`🔍 Checking availability for ${villaType}:`);
    console.log(`   Requested: ${checkinDate.toDateString()} -> ${checkoutDate.toDateString()}`);
    
    const villaBookings = allBookings.filter(b => 
        normalizeVillaType(b.villaType) === normalizedTargetType
    );
    
    console.log(`   Found ${villaBookings.length} existing bookings`);
    
    let conflictBookings = [];
    let conflictDates = [];
    
    for (const booking of villaBookings) {
        const bookedCheckin = booking.parsedCheckIn;
        const bookedCheckout = booking.parsedCheckOut;
        
        console.log(`   vs Existing: ${bookedCheckin.toDateString()} -> ${bookedCheckout.toDateString()}`);
        
        // PERBAIKAN: LOGIKA OVERLAP YANG BENAR
        const hasConflict = (
            // Kasus 1: Check-in Anda di tengah periode booking existing
            (checkinDate >= bookedCheckin && checkinDate < bookedCheckout) ||
            
            // Kasus 2: Check-out Anda di tengah periode booking existing (TIDAK BOLEH)
            // KECUALI check-out Anda = check-in booking existing (BOLEH)
            (checkoutDate > bookedCheckin && checkoutDate <= bookedCheckout && 
             checkoutDate.getTime() !== bookedCheckin.getTime())
        );
        
        if (hasConflict) {
            console.log(`   ❌ CONFLICT DETECTED!`);
            
            conflictBookings.push({
                checkin: booking.checkIn,
                checkout: booking.checkOut,
                parsedCheckin: bookedCheckin,
                parsedCheckout: bookedCheckout
            });
            
            // Tandai tanggal-tanggal yang conflict (untuk check-in saja)
            let current = new Date(Math.max(checkinDate, bookedCheckin));
            const end = new Date(Math.min(checkoutDate, bookedCheckout));
            
            while (current < end) {
                const dateStr = current.toISOString().split('T')[0];
                if (!conflictDates.includes(dateStr)) {
                    conflictDates.push(dateStr);
                }
                current.setDate(current.getDate() + 1);
            }
        } else {
            console.log(`   ✅ No conflict`);
        }
    }
    
    if (conflictBookings.length > 0) {
        return { 
            available: false, 
            conflictDates: conflictDates.sort(),
            conflictBookings: conflictBookings 
        };
    }
    
    console.log(`   ✅ Villa ${villaType} available!`);
    return { available: true, conflictDates: [], conflictBookings: [] };
}

// ==================== HIDE BOOKING FORM ====================
function setupInputChangeListeners() {
    console.log('🔧 Setting up input change listeners...');
    
    const arrivalInput = document.getElementById('arrival-date');
    const departureInput = document.getElementById('departure-date');
    const villaSelect = document.getElementById('villa-type');
    const bookingFormSection = document.getElementById('booking-details-form');
    
    if (!bookingFormSection) return;
    
    function hideBookingForm() {
        if (bookingFormSection.style.display === 'block') {
            console.log('📝 Input changed - hiding booking form');
            bookingFormSection.style.display = 'none';
            
            document.getElementById('full-name').value = '';
            document.getElementById('phone').value = '';
            document.getElementById('email').value = '';
            document.getElementById('identity-photo').value = '';
            document.getElementById('payment-proof').value = '';
            document.getElementById('special-request').value = '';
        }
    }
    
    if (arrivalInput) {
        arrivalInput.addEventListener('change', hideBookingForm);
        arrivalInput.addEventListener('input', hideBookingForm);
    }
    
    if (departureInput) {
        departureInput.addEventListener('change', hideBookingForm);
        departureInput.addEventListener('input', hideBookingForm);
    }
    
    if (villaSelect) {
        villaSelect.addEventListener('change', hideBookingForm);
    }
    
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('flatpickr-day') || 
            e.target.classList.contains('flatpickr-monthDropdown-months')) {
            setTimeout(hideBookingForm, 100);
        }
    });
    
    console.log('✅ Input change listeners setup complete');
}

// ==================== UPDATE CALENDAR ====================
function updateCalendarWithBookedDates() {
    if (window._updatingCalendar) return;
    
    window._updatingCalendar = true;
    
    try {
        const villaSelect = document.getElementById('villa-type');
        if (!villaSelect) return;
        
        const selectedVilla = villaSelect.value;
        const blockedForCheckin = getBookedDatesForVilla(selectedVilla);
        
        console.log(`📅 Villa ${selectedVilla}: ${blockedForCheckin.length} tanggal diblokir untuk CHECK-IN`);
        
        // Function untuk disable dates (HANYA untuk check-in)
        const disableForCheckin = function(date) {
            const dateStr = date.toISOString().split('T')[0];
            const isBlocked = blockedForCheckin.includes(dateStr);
            
            if (isBlocked) {
                console.log(`   ❌ Disabling ${dateStr} for check-in`);
            }
            
            return isBlocked;
        };
        
        // Arrival picker: disable tanggal yang tidak bisa untuk check-in
        if (window.arrivalPicker) {
            window.arrivalPicker.set('disable', [disableForCheckin]);
            console.log('✅ Arrival calendar updated');
        }
        
        // Departure picker: TIDAK perlu disable berdasarkan booked dates
        // karena check-out BOLEH sama dengan check-in booking lain
        if (window.departurePicker) {
            // Reset disable function untuk departure
            window.departurePicker.set('disable', []);
            console.log('✅ Departure calendar cleared (check-out boleh kapan saja)');
        }
        
    } catch (error) {
        console.error('❌ Error in updateCalendarWithBookedDates:', error);
    } finally {
        setTimeout(() => {
            window._updatingCalendar = false;
        }, 200);
    }
}

// ==================== APPLY BOOKED DATE STYLING ====================
function applyBookedDateStyling(bookedDates) {
    console.log('🎨 Applying styling for booked dates:', bookedDates);
    
    const allDateElements = document.querySelectorAll('.flatpickr-day');
    
    allDateElements.forEach(day => {
        day.style.backgroundColor = '';
        day.style.color = '';
        day.style.fontWeight = '';
        day.style.textDecoration = '';
        day.style.opacity = '';
        day.title = '';
        
        const dateAttr = day.getAttribute('data-date');
        if (dateAttr) {
            const dateParts = dateAttr.split('-');
            const year = dateParts[0];
            const month = String(dateParts[1]).padStart(2, '0');
            const dayNum = String(dateParts[2]).padStart(2, '0');
            const dateStr = `${year}-${month}-${dayNum}`;
            
            if (bookedDates.includes(dateStr)) {
                day.classList.add('disabled');
                day.style.backgroundColor = '#ff4d4d';
                day.style.color = 'white';
                day.style.fontWeight = 'bold';
                day.style.textDecoration = 'line-through';
                day.style.opacity = '0.8';
                day.title = '❌ Sudah dibooking';
                day.style.cursor = 'not-allowed';
                day.classList.add('flatpickr-disabled');
                
                console.log(`✅ Styled booked date: ${dateStr}`);
            }
        }
    });
    
    console.log('🎨 Booked date styling applied');
}

// ==================== INITIALIZE DATE PICKERS ====================
function initializeDatePickers() {
    console.log('📅 Menginisialisasi date pickers...');
    
    const arrivalInput = document.getElementById('arrival-date');
    const departureInput = document.getElementById('departure-date');
    
    if (!arrivalInput || !departureInput) {
        console.error('Elemen input tidak ditemukan');
        return;
    }
    
    if (window.arrivalPicker) window.arrivalPicker.destroy();
    if (window.departurePicker) window.departurePicker.destroy();
    
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // TAMBAH: Reset nilai input ke kosong
    arrivalInput.value = '';
    departureInput.value = '';
    
    const config = {
        dateFormat: "Y-m-d",
        clickOpens: true,
        allowInput: false,
        disableMobile: false,
        static: true,
        monthSelectorType: "dropdown",
        yearSelectorType: "dropdown",
        // ⬇️ HAPUS defaultDate dari sini!
        locale: {
            firstDayOfWeek: 1,
            weekdays: {
                shorthand: ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
                longhand: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
            },
            months: {
                shorthand: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
                longhand: ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
            }
        },
        onOpen: function(selectedDates, dateStr, instance) {
            // ⬇️ HAPUS auto-set ke Desember 2025
            // Biarkan kalender terbuka tanpa default date
            
            setTimeout(() => {
                updateCalendarWithBookedDates();
            }, 200);
        }
    };
    
    // Arrival date picker - MINIMAL BESOK
    window.arrivalPicker = flatpickr(arrivalInput, {
        ...config,
        minDate: tomorrow, // Minimal besok
        onReady: function(selectedDates, dateStr, instance) {
            // Panggil update booked dates setelah calendar siap
            setTimeout(() => {
                updateCalendarWithBookedDates();
            }, 300);
        },
        onChange: function(selectedDates, dateStr) {
            console.log('Check-in dipilih:', dateStr || '(kosong)');
            if (selectedDates[0]) {
                const nextDay = new Date(selectedDates[0]);
                nextDay.setDate(nextDay.getDate() + 1);
                
                if (window.departurePicker) {
                    window.departurePicker.set('minDate', nextDay);
                    
                    if (window.departurePicker.selectedDates[0] && 
                        window.departurePicker.selectedDates[0] <= selectedDates[0]) {
                        window.departurePicker.clear();
                    }
                }
            } else {
                // Jika check-in dikosongkan, reset minDate check-out
                if (window.departurePicker) {
                    const dayAfterTomorrow = new Date(tomorrow);
                    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
                    window.departurePicker.set('minDate', dayAfterTomorrow);
                }
            }
            updateBookingSummary();
        }
    });
    
    // Departure date picker - minimal 2 hari dari hari ini
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
    
    window.departurePicker = flatpickr(departureInput, {
        ...config,
        minDate: dayAfterTomorrow, // Minimal 2 hari dari sekarang
        onReady: function(selectedDates, dateStr, instance) {
            // Panggil update booked dates setelah calendar siap
            setTimeout(() => {
                updateCalendarWithBookedDates();
            }, 300);
        },
        onChange: function(selectedDates, dateStr) {
            console.log('Check-out dipilih:', dateStr || '(kosong)');
            updateBookingSummary();
        }
    });
    
    console.log('✅ Date pickers initialized - Check-in kosong/default');
}

// ==================== VILLA SELECTION ====================
function initVillaSelection() {
    const villaCards = document.querySelectorAll('.villa-card-select');
    const villaSelect = document.getElementById('villa-type');
    
    if (!villaCards.length || !villaSelect) return;
    
    // Fungsi untuk reset tanggal
    function resetDates() {
        if (window.arrivalPicker) {
            window.arrivalPicker.clear();
        }
        if (window.departurePicker) {
            window.departurePicker.clear();
        }
        
        // Reset input fields
        const arrivalInput = document.getElementById('arrival-date');
        const departureInput = document.getElementById('departure-date');
        if (arrivalInput) arrivalInput.value = '';
        if (departureInput) departureInput.value = '';
        
        // Reset minDate untuk departure picker
        if (window.departurePicker) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dayAfterTomorrow = new Date(tomorrow);
            dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);
            window.departurePicker.set('minDate', dayAfterTomorrow);
        }
        
        console.log('📅 Tanggal berhasil direset');
    }
    
    villaCards.forEach(card => {
        card.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const villaType = this.getAttribute('data-villa-type');
            console.log('Villa card clicked:', villaType);
            
            // Simpan villa type sebelumnya
            const previousVillaType = villaSelect.value;
            
            // Jika villa type berubah, reset tanggal
            if (previousVillaType !== villaType) {
                resetDates();
            }
            
            villaCards.forEach(c => {
                c.classList.remove('active');
                c.style.transform = 'none';
            });
            
            this.classList.add('active');
            this.style.transform = 'translateY(-5px)';
            
            villaSelect.value = villaType;
            
            updateCalendarWithBookedDates();
            updateBookingSummary();
            
            // Sembunyikan form booking details jika sedang terbuka
            const bookingFormSection = document.getElementById('booking-details-form');
            if (bookingFormSection && bookingFormSection.style.display === 'block') {
                bookingFormSection.style.display = 'none';
            }
            
            const bookingSection = document.getElementById('booking-section');
            if (bookingSection) {
                setTimeout(() => {
                    bookingSection.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                }, 300);
            }
        });
    });
    
    // Event listener untuk select box (dropdown)
    villaSelect.addEventListener('change', function() {
        const previousVillaType = this.getAttribute('data-previous-value') || '';
        
        // Jika villa type berubah, reset tanggal
        if (previousVillaType !== this.value) {
            resetDates();
        }
        
        // Update previous value
        this.setAttribute('data-previous-value', this.value);
        
        villaCards.forEach(card => {
            card.classList.remove('active');
            card.style.transform = 'none';
        });
        
        const selectedCard = document.querySelector(`.villa-card-select[data-villa-type="${this.value}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
            selectedCard.style.transform = 'translateY(-5px)';
        }
        
        updateCalendarWithBookedDates();
        updateBookingSummary();
        
        // Sembunyikan form booking details jika sedang terbuka
        const bookingFormSection = document.getElementById('booking-details-form');
        if (bookingFormSection && bookingFormSection.style.display === 'block') {
            bookingFormSection.style.display = 'none';
        }
    });
    
    // Set initial previous value
    villaSelect.setAttribute('data-previous-value', villaSelect.value);
    
    const firstCard = document.querySelector('.villa-card-select');
    if (firstCard && !document.querySelector('.villa-card-select.active')) {
        firstCard.classList.add('active');
        villaSelect.value = firstCard.getAttribute('data-villa-type');
        villaSelect.setAttribute('data-previous-value', villaSelect.value);
    }
}

// ==================== NOTIFICATION SYSTEM ====================
function showNotification(type, message) {
    const existingModal = document.getElementById('custom-notification-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'custom-notification-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.3s ease;
        padding: 1rem;
    `;
    
    let icon, title, titleColor;
    switch (type) {
        case 'error':
            icon = '❌';
            title = 'Perhatian';
            titleColor = '#ef4444';
            break;
        case 'success':
            icon = '✓';
            title = 'Berhasil';
            titleColor = '#10b981';
            break;
        case 'warning':
            icon = '⚠️';
            title = 'Peringatan';
            titleColor = '#f6ac0f';
            break;
        default:
            icon = 'ℹ️';
            title = 'Informasi';
            titleColor = '#3b82f6';
    }
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        padding: 1.5rem;
        border-radius: 15px;
        max-width: 500px;
        width: 100%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        animation: slideDown 0.3s ease;
    `;
    
    let contentHTML = message;
    
    if (!message.includes('<div') && !message.includes('<p') && !message.includes('<h')) {
        contentHTML = `
            <div style="text-align: center;">
                <div style="font-size: 48px; margin-bottom: 1rem;">${icon}</div>
                <h3 style="color: ${titleColor}; margin-bottom: 1rem; font-family: var(--header-font);">
                    ${title}
                </h3>
                <p style="color: var(--text-dark); margin-bottom: 1.5rem; line-height: 1.6;">
                    ${message}
                </p>
            </div>
        `;
    }
    
    modalContent.innerHTML = contentHTML + `
        <div style="text-align: center; margin-top: 1.5rem;">
            <button id="closeNotificationBtn" class="btn" 
                    style="background-color: ${titleColor}; 
                           color: white; padding: 0.75rem 2rem; font-size: 1rem; cursor: pointer;
                           border-radius: 8px; border: none; font-weight: 600;">
                OK, Saya Mengerti
            </button>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideDown { from { transform: translateY(-50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes slideUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-50px); opacity: 0; } }
    `;
    document.head.appendChild(style);
    
    document.getElementById('closeNotificationBtn').addEventListener('click', () => {
        modal.style.animation = 'fadeOut 0.3s ease';
        modalContent.style.animation = 'slideUp 0.3s ease';
        setTimeout(() => modal.remove(), 300);
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.animation = 'fadeOut 0.3s ease';
            modalContent.style.animation = 'slideUp 0.3s ease';
            setTimeout(() => modal.remove(), 300);
        }
    });
}

// ==================== DATE FORMATTING ====================
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = parseDate(dateStr);
    if (!date) return dateStr;
    
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    const date = parseDate(dateStr);
    if (!date) return dateStr;
    
    return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short'
    });
}

// ==================== BOOKING FORM HANDLING ====================
function updateBookingSummary() {
    const checkin = document.getElementById('arrival-date')?.value || '';
    const checkout = document.getElementById('departure-date')?.value || '';
    const villaSelect = document.getElementById('villa-type');
    const villaType = villaSelect?.value || '';
    const villaText = villaSelect?.options[villaSelect?.selectedIndex]?.text || '';
    
    currentBookingData = {
        checkin: checkin,
        checkout: checkout,
        villaType: villaType,
        villaText: villaText
    };
    
    document.getElementById('summary-checkin').textContent = formatDate(checkin) || '-';
    document.getElementById('summary-checkout').textContent = formatDate(checkout) || '-';
    document.getElementById('summary-villa').textContent = villaText || '-';

        // Hitung jumlah malam dan total harga
    let totalNights = 0;
    let totalPrice = 0;
    
    if (checkin && checkout) {
        const checkinDate = parseDate(checkin);
        const checkoutDate = parseDate(checkout);
        
        if (checkinDate && checkoutDate && checkoutDate > checkinDate) {
            const diffTime = checkoutDate - checkinDate;
            totalNights = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            // Hitung total harga
            const pricePerNight = VILLA_PRICES[villaType] || 0;
            totalPrice = pricePerNight * totalNights;
        }
    }

    updatePriceSummary(totalNights, totalPrice, villaType);

    document.getElementById('booking-checkin').value = checkin;
    document.getElementById('booking-checkout').value = checkout;
    document.getElementById('booking-villa-type').value = villaType;
    
    console.log('📝 Summary updated - Villa Type:', villaType, 'Nights:', totalNights, 'Price:', totalPrice);
}

// Function untuk update harga dengan desain yang lebih baik
function updatePriceSummary(nights, totalPrice, villaType) {
    // Cari atau buat container untuk info harga
    let priceContainer = document.getElementById('booking-price-details');
    
    if (!priceContainer) {
        // Cari posisi setelah "Tipe Villa"
        const villaElement = document.getElementById('summary-villa')?.parentElement;
        if (!villaElement) return;
        
        priceContainer = document.createElement('div');
        priceContainer.id = 'booking-price-details';
        priceContainer.style.cssText = `
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 2px dashed #e5e7eb;
        `;
        
        // Sisipkan setelah villa element
        villaElement.parentNode.insertBefore(priceContainer, villaElement.nextSibling);
    }
    
    const pricePerNight = VILLA_PRICES[villaType] || 0;
    
    priceContainer.innerHTML = `
        <div style="display: grid; gap: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-light); font-size: 0.95rem;">Durasi</span>
                <span style="color: var(--text-dark); font-weight: 500; font-size: 0.95rem;">${nights} malam</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-light); font-size: 0.95rem;">Harga/malam</span>
                <span style="color: var(--text-dark); font-weight: 500; font-size: 0.95rem;">Rp ${formatCurrency(pricePerNight)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.5rem; margin-top: 0.5rem; border-top: 1px solid #e5e7eb;">
                <span style="color: var(--text-dark); font-weight: 600; font-size: 1rem;">Total Pembayaran</span>
                <span style="color: var(--secondary-color); font-weight: bold; font-size: 1.2rem;">Rp ${formatCurrency(totalPrice)}</span>
            </div>
        </div>
    `;
}

// Function untuk format currency
function formatCurrency(amount) {
    if (!amount) return '0';
    return amount.toLocaleString('id-ID');
}

// ==================== FORM SUBMISSION ====================
function initFormSubmission() {
    const form = document.getElementById('booking-form');
    const completeForm = document.getElementById('complete-booking-form');
    const bookingFormSection = document.getElementById('booking-details-form');
    
    if (!form) {
        console.error('Booking form not found!');
        return;
    }
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        console.log('=== FORM SUBMISSION START ===');
        
        if (bookingFormSection && bookingFormSection.style.display === 'block') {
            bookingFormSection.style.display = 'none';
        }
        
        const arrivalDate = document.getElementById('arrival-date')?.value;
        const departureDate = document.getElementById('departure-date')?.value;
        const villaSelect = document.getElementById('villa-type');
        const villaType = villaSelect?.value;
        const villaText = villaSelect?.options[villaSelect.selectedIndex]?.text;
        
        console.log('Form data:', {
            arrivalDate,
            departureDate,
            villaType,
            villaText
        });
        
        if (!arrivalDate || !departureDate || !villaType) {
            showNotification('warning', 'Silakan lengkapi semua field terlebih dahulu.');
            return;
        }
        
        const dateError = validateDates(arrivalDate, departureDate);
        if (dateError) {
            showNotification('warning', dateError);
            return;
        }
        
        const checkinDate = parseDate(arrivalDate);
        const checkoutDate = parseDate(departureDate);
        
        // LANGSUNG CEK AVAILABILITY dengan checkVillaAvailability()
        const availabilityResult = checkVillaAvailability(villaType, arrivalDate, departureDate);
        console.log('Availability check result:', availabilityResult);
        
        if (!availabilityResult.available) {
            let conflictDetailsHTML = '';
            
            if (availabilityResult.conflictBookings.length > 0) {
                conflictDetailsHTML += `
                    <div style="margin-bottom: 1rem;">
                        <p style="color: #b91c1c; margin-bottom: 0.5rem; font-weight: 600;">
                            <strong>Booking yang bentrok:</strong>
                        </p>`;
                
                availabilityResult.conflictBookings.forEach((booking, index) => {
                    conflictDetailsHTML += `
                        <div style="background: #fee2e2; padding: 0.75rem; border-radius: 6px; margin-bottom: 0.5rem;">
                            <p style="color: #b91c1c; margin: 0; font-size: 0.9rem;">
                                <strong>Booking #${index + 1}:</strong><br>
                                📅 ${formatDate(booking.checkin)} - ${formatDate(booking.checkout)}
                            </p>
                        </div>
                    `;
                });
                
                conflictDetailsHTML += `</div>`;
            }
            
            if (availabilityResult.conflictDates.length > 0) {
                let dateRanges = [];
                let currentRange = [];
                
                availabilityResult.conflictDates.forEach((dateStr, index) => {
                    const date = parseDate(dateStr);
                    if (index === 0) {
                        currentRange.push(dateStr);
                    } else {
                        const prevDate = parseDate(availabilityResult.conflictDates[index - 1]);
                        const dayDiff = (date - prevDate) / (1000 * 60 * 60 * 24);
                        
                        if (dayDiff === 1) {
                            currentRange.push(dateStr);
                        } else {
                            dateRanges.push([...currentRange]);
                            currentRange = [dateStr];
                        }
                    }
                });
                
                if (currentRange.length > 0) {
                    dateRanges.push(currentRange);
                }
                
                let formattedRanges = dateRanges.map(range => {
                    if (range.length === 1) {
                        return formatDateShort(range[0]);
                    } else {
                        return `${formatDateShort(range[0])} - ${formatDateShort(range[range.length - 1])}`;
                    }
                });
                
            }
            
            const errorMessage = 
                `<div style="text-align: center; padding: 0.5rem;">
                    <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Villa Tidak Tersedia</h3>
                    
                    <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                        <p style="color: #b91c1c; margin-bottom: 0.75rem; font-size: 1rem;">
                            <strong>Periode yang dipilih:</strong><br>
                            📅 ${formatDate(arrivalDate)} s/d ${formatDate(departureDate)}<br>
                            🏠 ${villaText}
                        </p>
                        
                        ${conflictDetailsHTML}
                    </div>
                    
                    <p style="color: var(--text-dark); margin-bottom: 1rem; font-size: 0.95rem;">
                        <strong>Penjelasan:</strong> Beberapa tanggal dalam periode Anda sudah dibooking oleh tamu lain. 
                        Villa tidak dapat ditempati oleh 2 tamu berbeda di waktu yang sama.
                    </p>
                    
                    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem;">
                        <p style="color: #0369a1; margin-bottom: 0.5rem; font-weight: 600;">
                            💡 <strong>Saran:</strong>
                        </p>
                        <ul style="color: #0369a1; text-align: left; margin: 0; padding-left: 1.5rem; font-size: 0.9rem;">
                            <li>Pilih tanggal lain yang tersedia (lihat kalender)</li>
                            <li>Coba villa lain dengan tipe berbeda</li>
                            <li>Periksa ketersediaan di bulan lain</li>
                        </ul>
                    </div>
                </div>`;
            
            showNotification('error', errorMessage);
            return;
        }
        
        console.log('✅ Villa available! Showing booking form...');
        
        document.getElementById('booking-checkin').value = arrivalDate;
        document.getElementById('booking-checkout').value = departureDate;
        document.getElementById('booking-villa-type').value = villaType;
        
        document.getElementById('summary-checkin').textContent = formatDate(arrivalDate);
        document.getElementById('summary-checkout').textContent = formatDate(departureDate);
        document.getElementById('summary-villa').textContent = villaText;
        
        const successMessage = 
            `<div style="text-align: center; padding: 0.5rem;">
                <div style="color: #10b981; font-size: 3rem; margin-bottom: 1rem;">
                    ✓
                </div>
                
                <h3 style="color: #10b981; margin-bottom: 1rem;">Villa Tersedia!</h3>
                
                <div style="background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem;">
                    <p style="color: #065f46; margin-bottom: 0.5rem;">
                        <strong>${villaText.toUpperCase()}</strong>
                    </p>
                    <p style="color: #065f46; margin-bottom: 0;">
                        📅 ${formatDate(arrivalDate)} - ${formatDate(departureDate)}
                    </p>
                </div>
                
                <p style="color: var(--text-dark); margin-bottom: 1.5rem; font-size: 0.95rem;">
                    Villa tersedia untuk periode ini.<br>
                    Silakan lanjutkan ke formulir booking.
                </p>
            </div>`;
        
        showNotification('success', successMessage);
        
        setTimeout(() => {
            if (bookingFormSection) {
                bookingFormSection.style.display = 'block';
                bookingFormSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                console.log('✅ Booking form shown');
                console.log('Villa type yang akan dikirim:', villaType);
            }
        }, 1500);
    });

    if (completeForm) {
        completeForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            console.log('=== COMPLETE FORM SUBMISSION START ===');
            
            const fullName = document.getElementById('full-name')?.value;
            const phone = document.getElementById('phone')?.value;
            const identityFile = document.getElementById('identity-photo');
            const paymentFile = document.getElementById('payment-proof');
            
            if (!fullName || !phone) {
                showNotification('warning', 'Nama dan WhatsApp harus diisi');
                return;
            }
            
            if (!identityFile?.files[0] || !paymentFile?.files[0]) {
                showNotification('warning', 'Harap upload foto identitas dan bukti transfer');
                return;
            }
            
            const villaTypeInput = document.getElementById('booking-villa-type');
            const villaType = villaTypeInput?.value;
            
            if (!villaType) {
                showNotification('error', 'Tipe villa tidak ditemukan. Silakan mulai booking ulang.');
                return;
            }
            
            console.log('Villa type yang akan dikirim:', villaType);
            
            const submitBtn = completeForm.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.innerHTML = '<div class="loading-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div> Mengirim...';
            submitBtn.disabled = true;
            
            try {
                console.log('Preparing form data...');
                const formData = new FormData(completeForm);
                
                const now = new Date();
                const bookingID = 'B' + 
                    now.getFullYear().toString().slice(-2) + 
                    (now.getMonth() + 1).toString().padStart(2, '0') + 
                    now.getDate().toString().padStart(2, '0') +
                    now.getHours().toString().padStart(2, '0') +
                    now.getMinutes().toString().padStart(2, '0') +
                    Math.floor(100 + Math.random() * 900);
                
                formData.append('booking_id', bookingID);
                formData.append('timestamp', new Date().toLocaleString('id-ID'));
                
                if (!formData.has('villa_type') && villaType) {
                    formData.append('villa_type', villaType);
                    console.log('✅ villa_type ditambahkan secara manual:', villaType);
                }
                
                console.log('=== DATA YANG AKAN DIKIRIM ===');
                for (let [key, value] of formData.entries()) {
                    if (typeof value === 'string') {
                        console.log(`  ${key}: "${value}"`);
                    } else {
                        console.log(`  ${key}: [File] ${value.name}`);
                    }
                }
                
                console.log('Mengirim ke process_booking_NEW.php...');
                const response = await fetch('process_booking_NEW.php', {
                    method: 'POST',
                    body: formData
                });
                
                console.log('Response status:', response.status);
                const result = await response.json();
                console.log('Response data:', result);
                
                if (result.success) {
                    console.log('✅ Success! Showing success message');
                    showSuccessMessage(result);
                } else {
                    console.error('❌ Server error:', result.message);
                    showNotification('error', result.message || 'Gagal mengirim data booking');
                }
                
            } catch (error) {
                console.error('❌ Network/JS error:', error);
                showNotification('error', 
                    'Terjadi kesalahan koneksi. ' +
                    'Silakan coba lagi atau hubungi customer service via WhatsApp.'
                );
            } finally {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
                console.log('=== FORM SUBMISSION END ===');
            }
        });
    }
}

// ==================== SUCCESS MESSAGE ====================
function showSuccessMessage(result) {
    const formSection = document.getElementById('booking-details-form');
    const container = formSection?.querySelector('.section__container');
    
    if (!container) return;
    
    const bookingID = result.booking_id || 'B' + Date.now().toString().slice(-6);
    const userName = document.getElementById('full-name')?.value || '';
    const userPhone = document.getElementById('phone')?.value || '';
    const checkin = document.getElementById('booking-checkin')?.value || '';
    const checkout = document.getElementById('booking-checkout')?.value || '';
    
    const villaSelect = document.getElementById('villa-type');
    const villaType = villaSelect?.value || '';
    const villaText = villaSelect?.options[villaSelect?.selectedIndex]?.text || '';
    
    container.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem;">
            <div style="width: 80px; height: 80px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                <i class="ri-check-line" style="color: white; font-size: 2.5rem;"></i>
            </div>
            
            <h2 style="color: #10b981; font-family: var(--header-font); margin-bottom: 0.5rem; font-size: 2rem;">
                Booking Berhasil!
            </h2>
            
            <p style="color: var(--text-light); margin-bottom: 2rem; font-size: 1rem;">
                Terima kasih telah booking di Aone Villa Trawas
            </p>
            
            <div style="background: linear-gradient(135deg, #f6ac0f 0%, #e69500 100%); padding: 1.5rem; border-radius: 10px; margin: 1.5rem 0; text-align: center; color: white; box-shadow: 0 5px 15px rgba(246, 172, 15, 0.3);">
                <p style="font-size: 0.9rem; margin-bottom: 0.5rem; opacity: 0.9;">Nomor Booking Anda</p>
                <p style="font-weight: bold; font-size: 1.8rem; letter-spacing: 1px; margin: 0;">${bookingID}</p>
            </div>
            
            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.5rem; margin: 1.5rem 0; text-align: left; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);">
                <h3 style="color: var(--primary-color); margin-bottom: 1.5rem; font-size: 1.1rem;">
                    <i class="ri-file-list-3-line" style="color: var(--secondary-color); margin-right: 8px;"></i>
                    Detail Reservasi
                </h3>
                
                <div style="display: grid; gap: 1rem;">
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.75rem;">
                        <span style="color: var(--text-light);">Booking ID</span>
                        <span style="color: var(--primary-color); font-weight: 600;">${bookingID}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.75rem;">
                        <span style="color: var(--text-light);">Nama Pemesan</span>
                        <span style="color: var(--text-dark); font-weight: 500;">${userName}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.75rem;">
                        <span style="color: var(--text-light);">WhatsApp</span>
                        <span style="color: var(--text-dark); font-weight: 500;">${userPhone}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.75rem;">
                        <span style="color: var(--text-light);">Check-in</span>
                        <span style="color: var(--text-dark); font-weight: 500;">${formatDate(checkin)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.75rem;">
                        <span style="color: var(--text-light);">Check-out</span>
                        <span style="color: var(--text-dark); font-weight: 500;">${formatDate(checkout)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-light);">Tipe Villa</span>
                        <span style="color: var(--secondary-color); font-weight: 600;">${villaText}</span>
                    </div>
                </div>
            </div>
            
            <div style="background: #fff3cd; border: 1px solid #ffecb5; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0; text-align: left;">
                <div style="display: flex; align-items: flex-start; gap: 1rem;">
                    <div style="background: #0f1a2c; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <i class="ri-camera-fill" style="font-size: 1rem;"></i>
                    </div>
                    <div>
                        <h4 style="color: #856404; margin-bottom: 0.5rem; font-size: 1.1rem;">
                            📸 <strong>Mohon Screenshot Halaman Ini!</strong>
                        </h4>
                        <p style="color: #856404; margin-bottom: 0.75rem; font-size: 0.95rem; line-height: 1.5;">
                            <strong>Catatan Penting:</strong> Screenshot halaman ini untuk bukti booking. 
                            Tunjukkan screenshot saat check-in di villa.
                        </p>
                    </div>
                </div>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 1rem; margin-top: 2rem; max-width: 500px; margin-left: auto; margin-right: auto;">
                <a href="https://wa.me/6281330000798?text=Halo,%20saya%20baru%20melakukan%20booking%20dengan%20ID:%20${bookingID}%0ANama:%20${encodeURIComponent(userName)}%0ATanggal:%20${encodeURIComponent(formatDate(checkin))}%20-%20${encodeURIComponent(formatDate(checkout))}%0AVilla:%20${encodeURIComponent(villaText)}%0A%0A*Mohon%20konfirmasi%20booking%20saya.%20Saya%20sudah%20melakukan%20pembayaran.*" 
                   target="_blank" 
                   style="background: #25d366; color: white; padding: 1rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1rem; transition: all 0.3s ease;">
                    <i class="ri-whatsapp-line" style="font-size: 1.3rem;"></i>
                    <span>Mohon Konfirmasi via WhatsApp</span>
                </a>
                
                <button onclick="location.reload()" 
                        style="background: linear-gradient(135deg, #0f1a2c 0%, #1a2a44 100%); color: white; padding: 1rem 1.5rem; border-radius: 8px; border: none; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1rem; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 12px rgba(15, 26, 44, 0.2);">
                    <i class="ri-home-4-line" style="font-size: 1.3rem;"></i>
                    <span>Kembali</span>
                </button>
            </div>
            
            <div style="margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
                <p style="color: var(--text-light); font-size: 0.9rem; margin-bottom: 0.5rem; text-align: left;">
                    <i class="ri-information-line" style="color: var(--secondary-color); margin-right: 5px;"></i>
                    <strong>Informasi Check-in:</strong> Datang ke villa pada tanggal check-in dengan menunjukkan:
                </p>
                <ul style="color: var(--text-light); font-size: 0.9rem; text-align: left; padding-left: 1.5rem; margin: 0;">
                    <li>Screenshot halaman ini / bukti booking</li>
                    <li>KTP asli sesuai nama pemesan</li>
                    <li>Booking ID: <strong>${bookingID}</strong></li>
                </ul>
            </div>
        </div>
    `;
    
    if (formSection) {
        formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ==================== REFRESH BUTTON ====================
function addRefreshButton() {
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'refresh-data-btn';
    refreshBtn.innerHTML = '🔄 Refresh Data';
    refreshBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 1000;
        background: var(--secondary-color);
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    
    refreshBtn.addEventListener('click', async function() {
        this.innerHTML = '🔄 Memuat...';
        this.disabled = true;
        
        await fetchAllBookings();
        
        setTimeout(() => {
            this.innerHTML = '✅ Data Diperbarui';
            setTimeout(() => {
                this.innerHTML = '🔄 Refresh Data';
                this.disabled = false;
            }, 2000);
        }, 500);
    });
    
    document.body.appendChild(refreshBtn);
}

// ==================== VILLA GRID WITH MINI CAROUSEL ====================
function initVillaGridCarousel() {
  console.log('🚀 Initializing Villa Grid with Carousel...');
  
  const villaCards = document.querySelectorAll('.villa-card');
  if (!villaCards.length) return;
  
  // State untuk setiap villa
  const villaStates = {};
  
  // Initialize semua villa
  villaCards.forEach((card, index) => {
    const villaType = card.getAttribute('data-villa-type');
    
    // Cari elemen carousel untuk villa ini
    const miniTrack = card.querySelector('.mini-track');
    const images = miniTrack.querySelectorAll('img');
    const dots = card.querySelectorAll('.mini-dot');
    const prevBtn = card.querySelector('.mini-prev');
    const nextBtn = card.querySelector('.mini-next');
    const timerProgress = card.querySelector('.timer-progress');
    
    // State untuk villa ini
    villaStates[villaType] = {
      currentIndex: 0,
      interval: null,
      isPaused: false,
      totalImages: images.length,
      images: images,
      dots: dots,
      track: miniTrack
    };
    
    console.log(`🏠 Villa ${villaType}: ${images.length} images`);
    
    // FUNGSI: Update image untuk villa tertentu
    function updateVillaImage(villaType, index) {
      const state = villaStates[villaType];
      
      // Validasi index
      if (index < 0 || index >= state.totalImages) return;
      
      // Update active classes
      state.images.forEach(img => img.classList.remove('active'));
      state.dots.forEach(dot => dot.classList.remove('active'));
      
      state.images[index].classList.add('active');
      state.dots[index].classList.add('active');
      
      // Update track position
      state.track.style.transform = `translateX(-${index * 100}%)`;
      
      // Update state
      state.currentIndex = index;
      
      // Reset timer
      if (state.interval) {
        clearInterval(state.interval);
        startVillaAutoSlide(villaType);
      }
    }
    
    // FUNGSI: Next image
    function nextVillaImage(villaType) {
      const state = villaStates[villaType];
      const nextIndex = (state.currentIndex + 1) % state.totalImages;
      updateVillaImage(villaType, nextIndex);
    }
    
    // FUNGSI: Prev image
    function prevVillaImage(villaType) {
      const state = villaStates[villaType];
      const prevIndex = (state.currentIndex - 1 + state.totalImages) % state.totalImages;
      updateVillaImage(villaType, prevIndex);
    }
    
    // FUNGSI: Start auto slide
    function startVillaAutoSlide(villaType) {
      const state = villaStates[villaType];
      
      // Clear existing interval
      if (state.interval) {
        clearInterval(state.interval);
      }
      
      // Start new interval (3 detik)
      state.interval = setInterval(() => {
        if (!state.isPaused) {
          nextVillaImage(villaType);
        }
      }, 3000);
    }
    
    // EVENT LISTENERS untuk villa ini
    
    // Navigation arrows
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prevVillaImage(villaType);
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextVillaImage(villaType);
      });
    }
    
    // Dots
    dots.forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(dot.getAttribute('data-index'));
        updateVillaImage(villaType, index);
      });
    });
    
    // Hover pause
    card.addEventListener('mouseenter', () => {
      villaStates[villaType].isPaused = true;
    });
    
    card.addEventListener('mouseleave', () => {
      villaStates[villaType].isPaused = false;
    });
    
    // Start auto slide
    startVillaAutoSlide(villaType);
  });
  
  // ===== VILLA SELECTION FOR BOOKING =====
  
  // Reset active classes
  function resetActiveVillaCards() {
    villaCards.forEach(card => {
      card.classList.remove('active');
      card.style.transform = 'none';
    });
  }
  
  // Villa click untuk booking
  villaCards.forEach(card => {
    card.addEventListener('click', function(e) {
      // Skip jika klik pada carousel controls
      if (e.target.closest('.mini-arrow') || e.target.closest('.mini-dot')) {
        return;
      }
      
      const villaType = this.getAttribute('data-villa-type');
      console.log(`✅ Villa selected: ${villaType}`);
      
      // Update active card
      resetActiveVillaCards();
      this.classList.add('active');
      this.style.transform = 'translateY(-5px)';
      
      // Update booking form
      const villaSelect = document.getElementById('villa-type');
      if (villaSelect) {
        const previousVillaType = villaSelect.value;
        villaSelect.value = villaType;
        
        // Reset dates jika villa berubah
        if (previousVillaType !== villaType) {
          if (window.arrivalPicker) window.arrivalPicker.clear();
          if (window.departurePicker) window.departurePicker.clear();
          
          const arrivalInput = document.getElementById('arrival-date');
          const departureInput = document.getElementById('departure-date');
          if (arrivalInput) arrivalInput.value = '';
          if (departureInput) departureInput.value = '';
          
          console.log('📅 Dates reset because villa changed');
        }
        
        // Update calendar dan summary
        updateCalendarWithBookedDates();
        updateBookingSummary();
        
        // Scroll ke booking section
        const bookingSection = document.getElementById('booking-section');
        if (bookingSection) {
          setTimeout(() => {
            bookingSection.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'start' 
            });
          }, 300);
        }
      }
    });
  });
  
  // Set villa pertama sebagai active
  if (villaCards.length > 0) {
    villaCards[0].classList.add('active');
    const firstVillaType = villaCards[0].getAttribute('data-villa-type');
    const villaSelect = document.getElementById('villa-type');
    if (villaSelect) {
      villaSelect.value = firstVillaType;
      villaSelect.setAttribute('data-previous-value', firstVillaType);
    }
  }
  
  console.log('✅ Villa Grid with Carousel initialized!');
}

// ==================== INITIALIZE EVERYTHING ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('=== SISTEM BOOKING AONE VILLA ===');
    
    addRefreshButton();
    
    setTimeout(() => {
        fetchAllBookings();
        initializeDatePickers();
        initFormSubmission();
        initVillaSelection();
        setupInputChangeListeners();
        updateBookingSummary();

    setTimeout(() => {
      initVillaGridCarousel();
    }, 500);
            
        setInterval(fetchAllBookings, 30000);
        
        const villaSelect = document.getElementById('villa-type');
        if (villaSelect) {
            villaSelect.addEventListener('change', function() {
                console.log('🎯 Villa type berubah ke:', this.value);
                
                // Reset tanggal saat villa berubah
                const previousVillaType = this.getAttribute('data-previous-value') || '';
                if (previousVillaType !== this.value) {
                    if (window.arrivalPicker) window.arrivalPicker.clear();
                    if (window.departurePicker) window.departurePicker.clear();
                    
                    const arrivalInput = document.getElementById('arrival-date');
                    const departureInput = document.getElementById('departure-date');
                    if (arrivalInput) arrivalInput.value = '';
                    if (departureInput) departureInput.value = '';
                    
                    console.log('📅 Tanggal direset karena villa berubah');
                }
                
                setTimeout(() => {
                    updateCalendarWithBookedDates();
                }, 150);
            });
        }
        
        document.addEventListener('click', function(e) {
            if (e.target.id === 'arrival-date' || e.target.id === 'departure-date') {
                setTimeout(() => {
                    updateCalendarWithBookedDates();
                }, 300);
            }
        });
        
        console.log('✅ Sistem booking siap digunakan!');
    }, 100);

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            console.log('🔄 Tab aktif - refreshing data...');
            fetchAllBookings();
        }
    });
});