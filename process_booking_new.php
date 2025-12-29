<?php
// process_booking_NEW.php - PERBAIKAN UNTUK GOOGLE SHEETS
error_reporting(E_ALL);
ini_set('display_errors', 1);

// ⬇️ URL Script Terpisah
$googleSheetsURL = 'https://script.google.com/macros/s/AKfycbyJ-94cKR67Lf88JhfW13pd6fAWdJmLlH_ZUaOc02_zm1BKbzmssTQ_zlW6gcFvnvVJjQ/exec'; // Script A - Sheets
$googleDriveURL = 'https://script.google.com/macros/s/AKfycbwyL3V-rnFPMDWhVTBQ95InQOvcfhOjtufDwbiH1hzt619eukHpsrB1bdth-iKOOcsH/exec';   // Script B - Drive

header('Content-Type: application/json');

// ⬇️ SINGLE DEBUG FILE - SEMUA DATA DALAM SATU FILE
$debug_file = 'booking_debug.txt';
$debug_content = "\n" . str_repeat("=", 60) . "\n";
$debug_content .= "📅 NEW BOOKING ATTEMPT - " . date('Y-m-d H:i:s') . "\n";
$debug_content .= str_repeat("=", 60) . "\n\n";

// ⬇️ LOG REQUEST HEADERS
$debug_content .= "🌐 REQUEST HEADERS:\n";
foreach (getallheaders() as $name => $value) {
    $debug_content .= "  • $name: $value\n";
}
$debug_content .= "\n";

// ⬇️ DUMP ALL INPUT DATA - DETAILED
$debug_content .= "📋 RAW POST DATA:\n";
foreach ($_POST as $key => $value) {
    $debug_content .= "  • $key = \"" . htmlspecialchars($value, ENT_QUOTES) . "\"\n";
}

$debug_content .= "\n📁 FILES UPLOADED:\n";
if (isset($_FILES) && !empty($_FILES)) {
    foreach ($_FILES as $key => $file) {
        if (isset($file['name'])) {
            $debug_content .= "  • $key: " . $file['name'] . 
                            " | Size: " . $file['size'] . 
                            " bytes | Type: " . $file['type'] . 
                            " | Error: " . $file['error'] . "\n";
        }
    }
} else {
    $debug_content .= "  • No files uploaded\n";
}

$debug_content .= "\n📝 PHP ENVIRONMENT:\n";
$debug_content .= "  • POST Method: " . $_SERVER['REQUEST_METHOD'] . "\n";
$debug_content .= "  • Content-Type: " . ($_SERVER['CONTENT_TYPE'] ?? 'not set') . "\n";
$debug_content .= "  • Content-Length: " . ($_SERVER['CONTENT_LENGTH'] ?? '0') . "\n";
$debug_content .= "  • Script: " . $_SERVER['PHP_SELF'] . "\n\n";

// ⬇️ VALIDASI DATA WAJIB
$required_fields = ['full_name', 'phone', 'checkin', 'checkout', 'villa_type'];
$missing_fields = [];

foreach ($required_fields as $field) {
    if (empty($_POST[$field])) {
        $missing_fields[] = $field;
    }
}

if (!empty($missing_fields)) {
    $debug_content .= "❌ ERROR: Missing required fields: " . implode(', ', $missing_fields) . "\n";
    file_put_contents($debug_file, $debug_content, FILE_APPEND);
    
    echo json_encode([
        'success' => false,
        'message' => "Harap lengkapi field: " . implode(', ', array_map(function($f) { 
            return str_replace('_', ' ', $f); 
        }, $missing_fields))
    ]);
    exit;
}

// ⬇️ GENERATE BOOKING ID
$booking_id = $_POST['booking_id'] ?? 'B' . date('YmdHis') . rand(100, 999);
$debug_content .= "✅ Booking ID Generated: $booking_id\n\n";

// ⬇️ PREPARE UPLOAD DIRECTORY
$upload_dir = 'uploads/' . date('Y/m/');
if (!file_exists($upload_dir)) {
    mkdir($upload_dir, 0777, true);
    $debug_content .= "📁 Created upload directory: $upload_dir\n";
}

// ⬇️ STEP 1: PROCESS FILE UPLOADS (Lokal + Google Drive)
$drive_results = ['identity' => null, 'payment' => null];
$files_uploaded = false;
$identity_filename = '';
$payment_filename = '';

// Process Identity File
if (isset($_FILES['identity_photo']) && $_FILES['identity_photo']['error'] === UPLOAD_ERR_OK) {
    $debug_content .= "\n=== PROCESSING IDENTITY FILE ===\n";
    
    $identity_file = $_FILES['identity_photo'];
    $identity_filename = $booking_id . '_IDENTITY_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($identity_file['name']));
    
    $debug_content .= "  Original name: " . $identity_file['name'] . "\n";
    $debug_content .= "  New name: $identity_filename\n";
    
    // Save locally
    $local_path = $upload_dir . $identity_filename;
    
    if (move_uploaded_file($identity_file['tmp_name'], $local_path)) {
        $debug_content .= "  ✅ Saved locally: $local_path\n";
        $files_uploaded = true;
    } else {
        $debug_content .= "  ⚠️ Failed to save locally\n";
        $identity_filename = 'UPLOAD_FAILED_' . basename($identity_file['name']);
    }
} else {
    $identity_filename = 'NO_FILE';
}

// Process Payment File
if (isset($_FILES['payment_proof']) && $_FILES['payment_proof']['error'] === UPLOAD_ERR_OK) {
    $debug_content .= "\n=== PROCESSING PAYMENT FILE ===\n";
    
    $payment_file = $_FILES['payment_proof'];
    $payment_filename = $booking_id . '_PAYMENT_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', basename($payment_file['name']));
    
    $debug_content .= "  Original name: " . $payment_file['name'] . "\n";
    $debug_content .= "  New name: $payment_filename\n";
    
    // Save locally
    $local_path = $upload_dir . $payment_filename;
    
    if (move_uploaded_file($payment_file['tmp_name'], $local_path)) {
        $debug_content .= "  ✅ Saved locally: $local_path\n";
        $files_uploaded = true;
    } else {
        $debug_content .= "  ⚠️ Failed to save locally\n";
        $payment_filename = 'UPLOAD_FAILED_' . basename($payment_file['name']);
    }
} else {
    $payment_filename = 'NO_FILE';
}

// ⬇️ STEP 2: SAVE TO GOOGLE SHEETS (PRIORITAS UTAMA)
$debug_content .= "\n" . str_repeat("=", 60) . "\n";
$debug_content .= "📤 PREPARING DATA FOR GOOGLE SHEETS\n";
$debug_content .= str_repeat("=", 60) . "\n";

// ⬇️ PREPARE DATA FOR GOOGLE SHEETS - DENGAN FORMAT YANG SIMPLE
$sheets_data = [
    'timestamp' => date('Y-m-d H:i:s'),
    'booking_id' => $booking_id,
    'full_name' => trim($_POST['full_name']),
    'phone' => trim($_POST['phone']),
    'email' => isset($_POST['email']) ? trim($_POST['email']) : '',
    'checkin' => trim($_POST['checkin']),
    'checkout' => trim($_POST['checkout']),
    'villa_type' => trim($_POST['villa_type']),
    'identity_file' => $identity_filename,
    'payment_file' => $payment_filename,
    'special_request' => isset($_POST['special_request']) ? trim($_POST['special_request']) : ''
];

// Log all data being sent
foreach ($sheets_data as $key => $value) {
    $debug_content .= "  • $key: \"" . $value . "\"\n";
}

$debug_content .= "\n🔗 Google Sheets URL: $googleSheetsURL\n\n";

// ⬇️ FUNCTION UNTUK MENGIRIM KE GOOGLE SHEETS
function sendToGoogleSheets($url, $data, &$debug_content) {
    $debug_content .= "📤 SENDING TO GOOGLE SHEETS...\n";
    
    // Coba format FORM DATA dulu (biasanya lebih kompatibel)
    $post_fields = http_build_query($data);
    $debug_content .= "📦 Data size: " . strlen($post_fields) . " bytes\n";
    $debug_content .= "📦 Data sample: " . substr($post_fields, 0, 200) . "\n";
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $post_fields,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json'
        ],
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ]);
    
    // Enable verbose mode for debugging
    curl_setopt($ch, CURLOPT_VERBOSE, false);
    $verbose = fopen('php://temp', 'w+');
    curl_setopt($ch, CURLOPT_STDERR, $verbose);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_error = curl_error($ch);
    
    // Get verbose output
    rewind($verbose);
    $verbose_log = stream_get_contents($verbose);
    
    curl_close($ch);
    
    $debug_content .= "📡 HTTP Response Code: $http_code\n";
    $debug_content .= "📡 cURL Error: " . ($curl_error ?: 'none') . "\n";
    $debug_content .= "📡 Response Length: " . strlen($response) . " bytes\n";
    $debug_content .= "📡 Response: " . htmlspecialchars(substr($response, 0, 500)) . "\n";
    
    // Coba decode response
    $result = json_decode($response, true);
    
    if (!$result && !empty($response)) {
        $debug_content .= "⚠️ Response bukan JSON, mungkin HTML/plain text\n";
        // Coba ekstrak pesan dari response
        if (strpos($response, 'success') !== false) {
            $debug_content .= "ℹ️ Response mengandung kata 'success'\n";
        }
    }
    
    return [
        'response' => $response,
        'http_code' => $http_code,
        'curl_error' => $curl_error,
        'result' => $result,
        'verbose_log' => $verbose_log
    ];
}

// ⬇️ MENGIRIM KE GOOGLE SHEETS
try {
    $debug_content .= "\n" . str_repeat("=", 60) . "\n";
    $debug_content .= "🚀 ATTEMPTING TO SEND TO GOOGLE SHEETS\n";
    $debug_content .= str_repeat("=", 60) . "\n";
    
    $sheets_result = sendToGoogleSheets($googleSheetsURL, $sheets_data, $debug_content);
    
    // Analisis response
    if ($sheets_result['curl_error']) {
        throw new Exception("cURL Error: " . $sheets_result['curl_error']);
    }
    
    if ($sheets_result['http_code'] !== 200) {
        throw new Exception("HTTP Error: " . $sheets_result['http_code']);
    }
    
    // Cek jika response valid
    if ($sheets_result['result']) {
        if (isset($sheets_result['result']['success']) && $sheets_result['result']['success']) {
            $debug_content .= "\n✅ GOOGLE SHEETS SUCCESS!\n";
            $debug_content .= "   • Message: " . ($sheets_result['result']['message'] ?? 'Data saved') . "\n";
            $debug_content .= "   • Row: " . ($sheets_result['result']['row'] ?? 'unknown') . "\n";
        } else {
            throw new Exception("Google Sheets Script Error: " . 
                ($sheets_result['result']['message'] ?? 'Unknown error'));
        }
    } else {
        // Jika bukan JSON, coba cek apakah ada pesan sukses
        if (strpos($sheets_result['response'], 'success') !== false || 
            strpos($sheets_result['response'], 'Success') !== false) {
            $debug_content .= "\n⚠️ Google Sheets mungkin berhasil (non-JSON response)\n";
            // Lanjutkan proses meski response bukan JSON
        } else {
            $debug_content .= "\n❌ Invalid response from Google Sheets\n";
            $debug_content .= "Raw response: " . htmlspecialchars(substr($sheets_result['response'], 0, 500)) . "\n";
            
            // Coba method alternatif: kirim sebagai JSON
            $debug_content .= "\n🔄 Trying JSON method as fallback...\n";
            
            $ch_json = curl_init($googleSheetsURL);
            curl_setopt_array($ch_json, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($sheets_data),
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/json',
                    'Accept: application/json'
                ],
                CURLOPT_TIMEOUT => 30,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_USERAGENT => 'AoneVillaBooking/1.0'
            ]);
            
            $json_response = curl_exec($ch_json);
            $json_http = curl_getinfo($ch_json, CURLINFO_HTTP_CODE);
            curl_close($ch_json);
            
            $debug_content .= "JSON method HTTP: $json_http\n";
            $debug_content .= "JSON response: " . substr($json_response, 0, 300) . "\n";
            
            if ($json_http === 200) {
                $debug_content .= "✅ JSON method successful\n";
            } else {
                throw new Exception("Both form and JSON methods failed");
            }
        }
    }
    
    // ⬇️ STEP 3: UPLOAD TO GOOGLE DRIVE (jika ada file yang berhasil diupload)
    if ($files_uploaded) {
        $debug_content .= "\n" . str_repeat("=", 60) . "\n";
        $debug_content .= "☁️  UPLOADING TO GOOGLE DRIVE\n";
        $debug_content .= str_repeat("=", 60) . "\n";
        
        // Prepare data for Drive
        $drive_data = [
            'booking_id' => $booking_id,
            'timestamp' => date('Y-m-d H:i:s'),
            'full_name' => $sheets_data['full_name'],
            'villa_type' => $sheets_data['villa_type']
        ];
        
        $drive_uploads = [];
        
        // Add identity file if exists
        $identity_path = $upload_dir . $identity_filename;
        if ($identity_filename && $identity_filename !== 'NO_FILE' && $identity_filename !== 'UPLOAD_FAILED' && 
            file_exists($identity_path) && filesize($identity_path) > 0) {
            
            $identity_base64 = base64_encode(file_get_contents($identity_path));
            $drive_data['identity_base64'] = $identity_base64;
            $drive_data['identity_filename'] = $identity_filename;
            $drive_data['identity_type'] = mime_content_type($identity_path);
            
            $debug_content .= "  • Identity file prepared: $identity_filename (" . filesize($identity_path) . " bytes)\n";
            $drive_uploads['identity'] = $identity_filename;
        }
        
        // Add payment file if exists
        $payment_path = $upload_dir . $payment_filename;
        if ($payment_filename && $payment_filename !== 'NO_FILE' && $payment_filename !== 'UPLOAD_FAILED' && 
            file_exists($payment_path) && filesize($payment_path) > 0) {
            
            $payment_base64 = base64_encode(file_get_contents($payment_path));
            $drive_data['payment_base64'] = $payment_base64;
            $drive_data['payment_filename'] = $payment_filename;
            $drive_data['payment_type'] = mime_content_type($payment_path);
            
            $debug_content .= "  • Payment file prepared: $payment_filename (" . filesize($payment_path) . " bytes)\n";
            $drive_uploads['payment'] = $payment_filename;
        }
        
        if (!empty($drive_uploads)) {
            // Send to Drive Script as JSON
            $ch_drive = curl_init($googleDriveURL);
            curl_setopt_array($ch_drive, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($drive_data),
                CURLOPT_HTTPHEADER => [
                    'Content-Type: application/json',
                    'Accept: application/json'
                ],
                CURLOPT_TIMEOUT => 30,
                CURLOPT_SSL_VERIFYPEER => false
            ]);
            
            $drive_response = curl_exec($ch_drive);
            $drive_http = curl_getinfo($ch_drive, CURLINFO_HTTP_CODE);
            curl_close($ch_drive);
            
            $debug_content .= "  • Drive HTTP Code: $drive_http\n";
            
            $drive_result = json_decode($drive_response, true);
            
            if ($drive_result && isset($drive_result['success']) && $drive_result['success']) {
                $debug_content .= "  ✅ Drive upload successful!\n";
                $drive_results = $drive_result['uploads'] ?? $drive_uploads;
            } else {
                $debug_content .= "  ⚠️ Drive upload failed but files saved locally\n";
            }
        }
    }
    
    // ⬇️ FINAL SUCCESS RESPONSE
    $debug_content .= "\n" . str_repeat("=", 60) . "\n";
    $debug_content .= "🎉 PROCESS COMPLETED SUCCESSFULLY!\n";
    $debug_content .= str_repeat("=", 60) . "\n";
    $debug_content .= "  • Booking ID: $booking_id\n";
    $debug_content .= "  • Sheets Status: Success\n";
    $debug_content .= "  • Files Uploaded: " . ($files_uploaded ? 'Yes' : 'No') . "\n\n";
    
    // Save debug
    file_put_contents($debug_file, $debug_content, FILE_APPEND);
    
    // Return success
    echo json_encode([
        'success' => true,
        'message' => '✅ Booking berhasil diproses! Data telah disimpan.',
        'booking_id' => $booking_id,
        'sheets_status' => 'success',
        'drive_status' => !empty($drive_results) ? 'success' : 'skipped',
        'debug_info' => [
            'sheets_http' => $sheets_result['http_code'],
            'response_preview' => substr($sheets_result['response'], 0, 100)
        ]
    ]);
    
} catch (Exception $e) {
    $debug_content .= "\n❌ ERROR: " . $e->getMessage() . "\n";
    $debug_content .= "File: " . $e->getFile() . " Line: " . $e->getLine() . "\n";
    
    // Save debug
    file_put_contents($debug_file, $debug_content, FILE_APPEND);
    
    echo json_encode([
        'success' => false,
        'message' => 'Gagal memproses booking. Error: ' . $e->getMessage(),
        'booking_id' => $booking_id,
        'sheets_status' => 'failed',
        'error_details' => [
            'error' => $e->getMessage(),
            'sheets_response' => isset($sheets_result['response']) ? substr($sheets_result['response'], 0, 200) : 'No response'
        ]
    ]);
    exit;
}

// ⬇️ ADD SEPARATOR FOR NEXT LOG ENTRY
$separator = "\n" . str_repeat("-", 60) . "\n\n";
file_put_contents($debug_file, $separator, FILE_APPEND);
?>