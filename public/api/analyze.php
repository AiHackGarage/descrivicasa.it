<?php
/**
 * DescriviCasa — API proxy per OpenRouter
 * 
 * Hostinger supporta PHP nativamente. Questo script:
 * 1. Riceve le foto via POST
 * 2. Le invia a OpenRouter (Gemini 2.5 Flash Image)
 * 3. Restituisce la descrizione come JSON
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Usa POST']);
    exit;
}

// ── Config ────────────────────────────────────────────────
$apiKey = getenv('OPENROUTER_API_KEY');
if (!$apiKey) {
    // Leggi da un file .env nella root
    $envFile = __DIR__ . '/../.env';
    if (file_exists($envFile)) {
        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (str_starts_with($line, 'OPENROUTER_API_KEY=')) {
                $apiKey = substr($line, 19);
                break;
            }
        }
    }
}

if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'API key non configurata']);
    exit;
}

$visionModel = 'google/gemini-2.5-flash-image';

// ── Ricevi file ───────────────────────────────────────────
if (!isset($_FILES['files']) && !isset($_FILES['file'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Carica almeno una foto']);
    exit;
}

$files = $_FILES['files'] ?? ['tmp_name' => [$_FILES['file']['tmp_name']], 'name' => [$_FILES['file']['name']]];
$fileCount = is_array($files['tmp_name']) ? count($files['tmp_name']) : 1;

if ($fileCount === 0 || ($fileCount === 1 && empty($files['tmp_name'][0]))) {
    http_response_code(400);
    echo json_encode(['error' => 'Carica almeno una foto']);
    exit;
}

// ── Prepara messaggio per OpenRouter ─────────────────────
$content = [
    [
        'type' => 'text',
        'text' => "Descrivi questo immobile per un annuncio di vendita.\nDimmi anche: tipo di immobile (appartamento, villa, ufficio...), numero stanze/van, stile (moderno, classico, rustico...), piano, presenza di balconi/giardino, stato di manutenzione."
    ]
];

$uploadDir = __DIR__ . '/uploads';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

$savedPaths = [];
$imageUrls = [];

$tmpNames = is_array($files['tmp_name']) ? $files['tmp_name'] : [$files['tmp_name']];
$origNames = is_array($files['name']) ? $files['name'] : [$files['name']];

foreach ($tmpNames as $i => $tmp) {
    if (empty($tmp)) continue;
    
    $ext = pathinfo($origNames[$i] ?? 'photo.jpg', PATHINFO_EXTENSION);
    if (!in_array(strtolower($ext), ['jpg', 'jpeg', 'png', 'webp', 'gif'])) {
        $ext = 'jpg';
    }
    
    $filename = uniqid() . '.' . $ext;
    $dest = $uploadDir . '/' . $filename;
    
    if (move_uploaded_file($tmp, $dest)) {
        $savedPaths[] = $dest;
        $imageUrls[] = 'uploads/' . $filename;
        
        // Codifica in base64
        $imgData = base64_encode(file_get_contents($dest));
        $mime = 'image/' . ($ext === 'jpg' ? 'jpeg' : $ext);
        
        $content[] = [
            'type' => 'image_url',
            'image_url' => ['url' => "data:{$mime};base64,{$imgData}"]
        ];
    }
}

if (empty($savedPaths)) {
    http_response_code(400);
    echo json_encode(['error' => 'Errore nel salvataggio delle foto']);
    exit;
}

// ── Chiamata OpenRouter ──────────────────────────────────
$payload = json_encode([
    'model' => $visionModel,
    'messages' => [
        [
            'role' => 'system',
            'content' => "Sei un copywriter esperto nel settore immobiliare italiano.\nIl tuo compito è analizzare le foto di un immobile e scrivere una descrizione professionale in italiano per un annuncio di vendita.\n\nREGOLE:\n- Scrivi in italiano, tono caldo e professionale\n- Massimo 3 paragrafi\n- Includi dettagli reali che vedi nelle foto\n- Non inventare stanze o caratteristiche che non vedi\n- Sii onesto ma appassionante\n- Adatto a siti come Idealista, Immobiliare.it, Casa.it"
        ],
        ['role' => 'user', 'content' => $content]
    ],
    'max_tokens' => 1024,
    'temperature' => 0.7,
]);

$ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $apiKey,
        'Content-Type: application/json',
        'HTTP-Referer: https://descrivicasa.it',
        'X-Title: DescriviCasa',
    ],
    CURLOPT_TIMEOUT => 120,
    CURLOPT_CONNECTTIMEOUT => 10,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200) {
    http_response_code(500);
    echo json_encode(['error' => "API error {$httpCode}", 'detail' => substr($response, 0, 500)]);
    exit;
}

$data = json_decode($response, true);
$description = $data['choices'][0]['message']['content'] ?? '';
$model = $data['model'] ?? $visionModel;

// ── Risultato ─────────────────────────────────────────────
echo json_encode([
    'description' => $description,
    'images' => $imageUrls,
    'model' => $model,
], JSON_UNESCAPED_UNICODE);

// Pulisci upload vecchi (più di 1 ora)
foreach (glob($uploadDir . '/*') as $f) {
    if (time() - filemtime($f) > 3600) unlink($f);
}
