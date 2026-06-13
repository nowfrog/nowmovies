<?php
session_start();
header('Content-Type: application/json');

// Load config (API key + password hash)
$configPath = __DIR__ . '/config.php';
if (!file_exists($configPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Server not configured. Visit /admin/setup.php']);
    exit;
}
require_once $configPath;

$listeDir = __DIR__ . '/../liste';
$screenshotsBaseDir = __DIR__ . '/../screenshots';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// Public endpoints (no auth needed)
$preAction = isset($_POST['action']) ? strtolower(trim($_POST['action'])) : '';

// Auth status check
if ($preAction === 'auth_status') {
    echo json_encode(['authenticated' => !empty($_SESSION['admin'])]);
    exit;
}

// Login with session
if ($preAction === 'login') {
    $password = isset($_POST['password']) ? $_POST['password'] : '';
    if (password_verify($password, $adminPassword)) {
        $_SESSION['admin'] = true;
        $_SESSION['login_time'] = time();
        echo json_encode(['status' => 'ok']);
    } else {
        sleep(2); // Rate limit brute force
        http_response_code(401);
        echo json_encode(['error' => 'Password errata']);
    }
    exit;
}

// Logout
if ($preAction === 'logout') {
    session_destroy();
    echo json_encode(['status' => 'ok']);
    exit;
}

// Cross-list map (public, read-only)
if ($preAction === 'get_cross_list_map') {
    $manifestPath = $listeDir . '/manifest.json';
    $manifest = [];
    if (file_exists($manifestPath)) {
        $raw = json_decode(file_get_contents($manifestPath), true);
        if (is_array($raw)) {
            $manifest = array_map(function($item) {
                return is_string($item) ? $item : ($item['slug'] ?? '');
            }, $raw);
        }
    }
    $map = [];
    foreach ($manifest as $slug) {
        $fp = $listeDir . '/' . $slug . '.json';
        if (file_exists($fp)) {
            $data = json_decode(file_get_contents($fp), true);
            if (is_array($data)) {
                foreach ($data as $id => $m) {
                    $map[(string)$id][] = $slug;
                }
            }
        }
    }
    echo json_encode(['status' => 'ok', 'map' => $map]);
    exit;
}

// All other actions require session auth
// Support both session auth and legacy password auth (backward compat)
if (empty($_SESSION['admin'])) {
    $password = isset($_POST['password']) ? $_POST['password'] : '';
    if ($password !== '' && password_verify($password, $adminPassword)) {
        $_SESSION['admin'] = true;
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

$action = isset($_POST['action']) ? strtolower(trim($_POST['action'])) : '';

$listSlug = '';
if (isset($_POST['list_name']) && trim($_POST['list_name']) !== '') {
    $rawName = strtolower(trim($_POST['list_name']));
    $listSlug = preg_replace('/[^a-z0-9_]/', '', preg_replace('/\s+/', '_', $rawName));
} elseif (isset($_POST['list_slug'])) {
    $listSlug = strtolower(trim($_POST['list_slug']));
    $listSlug = preg_replace('/[^a-z0-9_-]/', '', $listSlug);
}

$imdbUrl = isset($_POST['imdb_url']) ? trim($_POST['imdb_url']) : '';
$rating = isset($_POST['rating']) ? trim($_POST['rating']) : '';

if ($listSlug === '' && $action !== 'update_description') {
    echo json_encode(['error' => 'Parametro list_name o list_slug mancante']);
    exit;
}

// --- Funzioni Helper ---

function httpGet(string $url): ?string {
    // 1. Prova curl PHP
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        $resp = curl_exec($ch);
        $ok = curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
        curl_close($ch);
        if ($resp !== false && $ok) return $resp;
    }
    // 2. Prova file_get_contents con SSL context
    if (in_array('https', stream_get_wrappers())) {
        $ctx = stream_context_create(['ssl' => ['verify_peer' => false, 'verify_peer_name' => false], 'http' => ['timeout' => 10]]);
        $resp = @file_get_contents($url, false, $ctx);
        if ($resp !== false) return $resp;
    }
    return null;
}

function imdbToTmdb(string $imdbId, string $apiKey): ?int {
    $url = "https://api.themoviedb.org/3/find/{$imdbId}?api_key={$apiKey}&external_source=imdb_id";
    $resp = httpGet($url);
    if ($resp === null) return null;
    $data = json_decode($resp, true);
    return !empty($data['movie_results'][0]['id']) ? (int) $data['movie_results'][0]['id'] : null;
}

function fetchMovieData(int $tmdbId, string $apiKey): ?array {
    $url = "https://api.themoviedb.org/3/movie/{$tmdbId}?api_key={$apiKey}&append_to_response=external_ids,credits";
    $resp = httpGet($url);
    if ($resp === null) return null;
    $data = json_decode($resp, true);
    if (!isset($data['id'])) return null;

    // Extract directors and top cast
    if (isset($data['credits'])) {
        $directors = [];
        foreach ($data['credits']['crew'] ?? [] as $person) {
            if ($person['job'] === 'Director') {
                $directors[] = ['id' => $person['id'], 'name' => $person['name'], 'profile_path' => $person['profile_path'] ?? null];
            }
        }
        $cast = [];
        foreach (array_slice($data['credits']['cast'] ?? [], 0, 10) as $person) {
            $cast[] = ['id' => $person['id'], 'name' => $person['name'], 'character' => $person['character'] ?? '', 'profile_path' => $person['profile_path'] ?? null];
        }
        $data['directors'] = $directors;
        $data['cast'] = $cast;
        unset($data['credits']); // Don't store the full credits blob
    }

    return $data;
}

function getListFilePath(string $listSlug, string $listeDir): string {
    return rtrim($listeDir, '/')."/{$listSlug}.json";
}

function loadList(string $filePath): array {
    if (file_exists($filePath)) {
        $json = file_get_contents($filePath);
        $data = json_decode($json, true);
        if (is_array($data)) return $data;
    }
    return [];
}

function saveList(string $filePath, array $data): void {
    file_put_contents($filePath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// Nuovo formato manifest: array di oggetti {slug, description}
function loadManifest(string $listeDir): array {
    $manifestPath = rtrim($listeDir, '/').'/manifest.json';
    if (file_exists($manifestPath)) {
        $json = file_get_contents($manifestPath);
        $data = json_decode($json, true);
        if (is_array($data)) {
            // Supporta sia il vecchio formato (array di stringhe) sia il nuovo (oggetti)
            return array_map(function($item) {
                if (is_string($item)) return ['slug' => $item, 'description' => '', 'color' => '#8e8e93', 'protected' => false];
                return ['slug' => $item['slug'] ?? '', 'description' => $item['description'] ?? '', 'color' => $item['color'] ?? '#8e8e93', 'protected' => $item['protected'] ?? false];
            }, $data);
        }
    }
    return [];
}

function saveManifest(string $listeDir, array $manifest): void {
    $manifestPath = rtrim($listeDir, '/').'/manifest.json';
    $clean = array_values(array_map(function($item) {
        $entry = [
            'slug' => $item['slug'],
            'description' => $item['description'] ?? '',
            'color' => $item['color'] ?? '#8e8e93'
        ];
        if (!empty($item['protected'])) $entry['protected'] = true;
        return $entry;
    }, $manifest));
    file_put_contents($manifestPath, json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function randomListColor(): string {
    $colors = ['#007aff','#34c759','#ff3b30','#ff9500','#af52de','#5ac8fa','#ffcc00','#30d158','#ff6482','#5856d6','#00c7be','#ff2d55'];
    return $colors[array_rand($colors)];
}

// Sync rating and screenshots for a movie across ALL lists
function syncMovieAcrossLists(int $tmdbId, string $listeDir, string $sourceSlug): void {
    $manifest = loadManifest($listeDir);
    $sourceFile = getListFilePath($sourceSlug, $listeDir);
    $sourceList = loadList($sourceFile);
    if (!isset($sourceList[$tmdbId])) return;

    $sourceMovie = $sourceList[$tmdbId];
    $rating = isset($sourceMovie['your-rating']) ? $sourceMovie['your-rating'] : null;
    $screenshots = isset($sourceMovie['screenshots']) ? $sourceMovie['screenshots'] : [];

    foreach ($manifest as $entry) {
        if ($entry['slug'] === $sourceSlug) continue;
        $filePath = getListFilePath($entry['slug'], $listeDir);
        $list = loadList($filePath);
        if (isset($list[$tmdbId])) {
            $changed = false;
            // Sync rating
            if ($rating !== null) {
                $list[$tmdbId]['your-rating'] = $rating;
                $changed = true;
            }
            // Merge screenshots (union)
            $existingSs = isset($list[$tmdbId]['screenshots']) ? $list[$tmdbId]['screenshots'] : [];
            $merged = array_values(array_unique(array_merge($existingSs, $screenshots)));
            if ($merged !== $existingSs) {
                $list[$tmdbId]['screenshots'] = $merged;
                $changed = true;
            }
            if ($changed) {
                saveList($filePath, $list);
            }
        }
    }
}

// Also collect screenshots/rating from OTHER lists into the source
function collectFromOtherLists(int $tmdbId, string $listeDir, string $sourceSlug): array {
    $manifest = loadManifest($listeDir);
    $allScreenshots = [];
    $rating = null;

    foreach ($manifest as $entry) {
        if ($entry['slug'] === $sourceSlug) continue;
        $filePath = getListFilePath($entry['slug'], $listeDir);
        $list = loadList($filePath);
        if (isset($list[$tmdbId])) {
            if ($rating === null && isset($list[$tmdbId]['your-rating'])) {
                $rating = $list[$tmdbId]['your-rating'];
            }
            if (isset($list[$tmdbId]['screenshots'])) {
                $allScreenshots = array_merge($allScreenshots, $list[$tmdbId]['screenshots']);
            }
        }
    }
    return ['rating' => $rating, 'screenshots' => array_values(array_unique($allScreenshots))];
}

function getTmdbIdFromParams($imdbUrl, $apiKey) {
    if ($imdbUrl === '') return ['error' => 'Parametro imdb_url mancante'];

    if (preg_match('/^tmdb:(\d+)$/', $imdbUrl, $matches)) {
        return (int) $matches[1];
    }

    $imdbId = '';
    if (preg_match('/tt\d+/', $imdbUrl, $matches)) $imdbId = $matches[0];
    if ($imdbId === '') return ['error' => 'ID IMDb non valido o non trovato nel link'];

    $tmdbId = imdbToTmdb($imdbId, $apiKey);
    if (!$tmdbId) return ['error' => 'Impossibile convertire l\'ID IMDb in ID TMDb'];

    return $tmdbId;
}

// --- Switch Azioni ---

switch ($action) {
    case 'create':
        $filePath = getListFilePath($listSlug, $listeDir);
        if (!file_exists($filePath)) {
            saveList($filePath, []);
            $manifest = loadManifest($listeDir);
            $found = false;
            foreach ($manifest as $entry) {
                if ($entry['slug'] === $listSlug) { $found = true; break; }
            }
            if (!$found) {
                $manifest[] = ['slug' => $listSlug, 'description' => ''];
                saveManifest($listeDir, $manifest);
            }
            echo json_encode(['status' => 'created', 'list_slug' => $listSlug]);
        } else {
            echo json_encode(['status' => 'exists', 'list_slug' => $listSlug]);
        }
        break;

    case 'delete':
        // Protect special lists
        if (in_array($listSlug, ['favourites', 'watchlist'])) {
            echo json_encode(['error' => 'This list cannot be deleted']);
            break;
        }
        $filePath = getListFilePath($listSlug, $listeDir);
        if (file_exists($filePath)) {
            unlink($filePath);
            $manifest = loadManifest($listeDir);
            $manifest = array_filter($manifest, function ($entry) use ($listSlug) {
                return $entry['slug'] !== $listSlug;
            });
            saveManifest($listeDir, $manifest);
            echo json_encode(['status' => 'deleted', 'list_slug' => $listSlug]);
        } else {
            echo json_encode(['error' => 'List not found']);
        }
        break;

    case 'update_description':
        $description = isset($_POST['description']) ? trim($_POST['description']) : '';
        $manifest = loadManifest($listeDir);
        $updated = false;
        foreach ($manifest as &$entry) {
            if ($entry['slug'] === $listSlug) {
                $entry['description'] = $description;
                $updated = true;
                break;
            }
        }
        unset($entry);
        if ($updated) {
            saveManifest($listeDir, $manifest);
            echo json_encode(['status' => 'description_updated', 'list_slug' => $listSlug]);
        } else {
            echo json_encode(['error' => 'Lista non trovata nel manifest']);
        }
        break;

    case 'add':
        $tmdbId = getTmdbIdFromParams($imdbUrl, $apiKey);
        if (is_array($tmdbId)) { echo json_encode($tmdbId); exit; }

        $movie = fetchMovieData($tmdbId, $apiKey);
        if (!$movie) { echo json_encode(['error' => 'Cannot fetch TMDb details']); exit; }

        // Collect existing data from this list
        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        // Collect rating/screenshots from OTHER lists
        $otherData = collectFromOtherLists($movie['id'], $listeDir, $listSlug);

        // Rating priority: user input > current list > other lists
        if ($rating !== '') {
            $movie['your-rating'] = $rating;
        } elseif (isset($list[$movie['id']]) && isset($list[$movie['id']]['your-rating'])) {
            $movie['your-rating'] = $list[$movie['id']]['your-rating'];
        } elseif ($otherData['rating'] !== null) {
            $movie['your-rating'] = $otherData['rating'];
        }

        // Merge screenshots: this list + other lists
        $existingScreenshots = [];
        if (isset($list[$movie['id']]) && isset($list[$movie['id']]['screenshots'])) {
            $existingScreenshots = $list[$movie['id']]['screenshots'];
        }
        $existingScreenshots = array_values(array_unique(array_merge($existingScreenshots, $otherData['screenshots'])));

        // Upload new screenshots
        $newScreenshots = [];
        if (isset($_FILES['screenshots']) && !empty($_FILES['screenshots']['name'][0])) {
            $movieDirName = (string)$movie['id'];
            $targetDir = $screenshotsBaseDir . '/' . $movieDirName . '/';

            if (!is_dir($targetDir)) {
                mkdir($targetDir, 0755, true);
            }

            $fileCount = count($_FILES['screenshots']['name']);
            for ($i = 0; $i < $fileCount; $i++) {
                if ($_FILES['screenshots']['error'][$i] === UPLOAD_ERR_OK) {
                    $tmpName = $_FILES['screenshots']['tmp_name'][$i];
                    $originalName = basename($_FILES['screenshots']['name'][$i]);
                    $safeName = preg_replace('/[^a-zA-Z0-9._-]/', '', $originalName);
                    $finalName = uniqid() . '_' . $safeName;
                    $destination = $targetDir . $finalName;

                    if (move_uploaded_file($tmpName, $destination)) {
                        $newScreenshots[] = "screenshots/{$movieDirName}/{$finalName}";
                    }
                }
            }
        }

        $allScreenshots = array_values(array_unique(array_merge($existingScreenshots, $newScreenshots)));
        if (!empty($allScreenshots)) {
            $movie['screenshots'] = $allScreenshots;
        }

        // Add added_date if new to this list
        if (!isset($list[$movie['id']])) {
            $movie['added_date'] = date('Y-m-d');
        } else {
            // Preserve existing added_date
            if (isset($list[$movie['id']]['added_date'])) {
                $movie['added_date'] = $list[$movie['id']]['added_date'];
            }
        }

        $list[$movie['id']] = $movie;
        saveList($filePath, $list);

        // Sync rating and screenshots to all other lists that have this movie
        syncMovieAcrossLists($movie['id'], $listeDir, $listSlug);

        $manifest = loadManifest($listeDir);
        $found = false;
        foreach ($manifest as $entry) {
            if ($entry['slug'] === $listSlug) { $found = true; break; }
        }
        if (!$found) {
            $manifest[] = ['slug' => $listSlug, 'description' => ''];
            saveManifest($listeDir, $manifest);
        }

        echo json_encode([
            'status' => 'added',
            'tmdb_id' => $tmdbId,
            'screenshots_uploaded' => count($newScreenshots),
            'total_screenshots' => isset($movie['screenshots']) ? count($movie['screenshots']) : 0
        ]);
        break;

    case 'remove':
        $tmdbId = null;
        if (isset($_POST['tmdb_id']) && trim($_POST['tmdb_id']) !== '') {
            $tmdbId = (int) trim($_POST['tmdb_id']);
        } else {
            $tmdbId = getTmdbIdFromParams($imdbUrl, $apiKey);
            if (is_array($tmdbId)) { echo json_encode($tmdbId); exit; }
        }

        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        if (isset($list[$tmdbId])) {
            unset($list[$tmdbId]);
            saveList($filePath, $list);
            echo json_encode(['status' => 'removed', 'tmdb_id' => $tmdbId]);
        } else {
            echo json_encode(['error' => 'Film non presente nella lista', 'tmdb_id' => $tmdbId]);
        }
        break;

    case 'get_movie_details':
        $tmdbId = getTmdbIdFromParams($imdbUrl, $apiKey);
        if (is_array($tmdbId)) { echo json_encode($tmdbId); exit; }

        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        if (isset($list[$tmdbId])) {
            $movie = $list[$tmdbId];
            echo json_encode([
                'status' => 'found',
                'title' => $movie['original_title'],
                'rating' => isset($movie['your-rating']) ? $movie['your-rating'] : null,
                'screenshots' => isset($movie['screenshots']) ? $movie['screenshots'] : []
            ]);
        } else {
            echo json_encode(['status' => 'not_found']);
        }
        break;

    case 'delete_single_screenshot':
        $tmdbId = getTmdbIdFromParams($imdbUrl, $apiKey);
        if (is_array($tmdbId)) { echo json_encode($tmdbId); exit; }

        $screenshotPath = isset($_POST['screenshot_path']) ? trim($_POST['screenshot_path']) : '';
        if (!$screenshotPath) {
            echo json_encode(['error' => 'Percorso screenshot mancante']);
            exit;
        }

        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        if (isset($list[$tmdbId])) {
            $movie = $list[$tmdbId];
            if (isset($movie['screenshots']) && in_array($screenshotPath, $movie['screenshots'])) {
                $fullPath = __DIR__ . '/../' . $screenshotPath;
                if (file_exists($fullPath)) {
                    unlink($fullPath);
                }
                $movie['screenshots'] = array_values(array_filter($movie['screenshots'], function($s) use ($screenshotPath) {
                    return $s !== $screenshotPath;
                }));
                $list[$tmdbId] = $movie;
                saveList($filePath, $list);
                echo json_encode(['status' => 'screenshot_deleted', 'remaining' => count($movie['screenshots'])]);
            } else {
                echo json_encode(['error' => 'Screenshot non trovato nei dati del film']);
            }
        } else {
            echo json_encode(['error' => 'Film non trovato nella lista']);
        }
        break;

    case 'get_global_movie_info':
        $tmdbId = getTmdbIdFromParams($imdbUrl, $apiKey);
        if (is_array($tmdbId)) { echo json_encode($tmdbId); exit; }

        $manifest = loadManifest($listeDir);
        $foundRating = null;
        $foundTitle = null;
        $foundScreenshots = [];
        $foundInLists = [];

        foreach ($manifest as $entry) {
            $fp = getListFilePath($entry['slug'], $listeDir);
            $list = loadList($fp);
            if (isset($list[$tmdbId])) {
                $m = $list[$tmdbId];
                $foundInLists[] = $entry['slug'];
                if ($foundTitle === null && isset($m['original_title'])) $foundTitle = $m['original_title'];
                if ($foundRating === null && isset($m['your-rating']) && $m['your-rating'] !== '' && $m['your-rating'] !== '-') {
                    $foundRating = $m['your-rating'];
                }
                if (isset($m['screenshots'])) {
                    $foundScreenshots = array_values(array_unique(array_merge($foundScreenshots, $m['screenshots'])));
                }
            }
        }

        if (!empty($foundInLists)) {
            echo json_encode([
                'status' => 'found',
                'title' => $foundTitle,
                'rating' => $foundRating,
                'screenshots' => $foundScreenshots,
                'lists' => $foundInLists
            ]);
        } else {
            echo json_encode(['status' => 'not_found']);
        }
        break;

    case 'get_movies_with_screenshots':
        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        $movies = [];
        foreach ($list as $id => $movie) {
            $ssCount = isset($movie['screenshots']) ? count($movie['screenshots']) : 0;
            if ($ssCount > 0) {
                $movies[] = [
                    'id' => $id,
                    'title' => isset($movie['original_title']) ? $movie['original_title'] : 'Unknown',
                    'year' => isset($movie['release_date']) ? substr($movie['release_date'], 0, 4) : '',
                    'screenshot_count' => $ssCount
                ];
            }
        }
        usort($movies, function($a, $b) {
            return strcasecmp($a['title'], $b['title']);
        });

        echo json_encode(['status' => 'ok', 'movies' => $movies]);
        break;

    case 'get_list_movies':
        $filePath = getListFilePath($listSlug, $listeDir);
        $list = loadList($filePath);

        $movies = [];
        foreach ($list as $id => $movie) {
            $movies[] = [
                'id' => $id,
                'title' => isset($movie['original_title']) ? $movie['original_title'] : 'Titolo sconosciuto',
                'year' => isset($movie['release_date']) ? substr($movie['release_date'], 0, 4) : ''
            ];
        }
        usort($movies, function($a, $b) {
            return strcasecmp($a['title'], $b['title']);
        });

        echo json_encode(['status' => 'ok', 'movies' => $movies]);
        break;

    case 'search_movies':
        $query = isset($_POST['query']) ? trim($_POST['query']) : '';
        if ($query === '') {
            echo json_encode(['error' => 'Query di ricerca mancante']);
            exit;
        }

        $searchUrl = "https://api.themoviedb.org/3/search/movie?api_key={$apiKey}&query=" . urlencode($query) . "&language=it-IT&page=1";
        $resp = httpGet($searchUrl);

        if ($resp === null) {
            echo json_encode(['error' => 'Errore nella ricerca TMDB']);
            exit;
        }

        $data = json_decode($resp, true);
        $results = [];

        if (isset($data['results']) && is_array($data['results'])) {
            $limited = array_slice($data['results'], 0, 10);
            foreach ($limited as $movie) {
                $results[] = [
                    'id' => $movie['id'],
                    'title' => $movie['title'],
                    'original_title' => isset($movie['original_title']) ? $movie['original_title'] : $movie['title'],
                    'year' => isset($movie['release_date']) ? substr($movie['release_date'], 0, 4) : '',
                    'poster' => isset($movie['poster_path']) ? 'https://image.tmdb.org/t/p/w92' . $movie['poster_path'] : null
                ];
            }
        }

        echo json_encode(['status' => 'ok', 'results' => $results]);
        break;

    // Returns {movie_id: [list_slug1, list_slug2, ...]} — no auth needed for public display
    case 'get_cross_list_map':
        $manifest = loadManifest($listeDir);
        $map = [];
        foreach ($manifest as $entry) {
            $filePath = getListFilePath($entry['slug'], $listeDir);
            $list = loadList($filePath);
            foreach ($list as $id => $movie) {
                $map[(string)$id][] = $entry['slug'];
            }
        }
        echo json_encode(['status' => 'ok', 'map' => $map]);
        break;

    // One-time sync: fix ratings and screenshots across all lists
    case 'sync_all':
        $manifest = loadManifest($listeDir);
        // Build a map: tmdb_id -> {rating, screenshots, latest_list}
        // We pick the rating from the list where the movie was added most recently
        // (heuristic: last list in manifest order that has the movie)
        $movieData = [];
        foreach ($manifest as $entry) {
            $filePath = getListFilePath($entry['slug'], $listeDir);
            $list = loadList($filePath);
            foreach ($list as $id => $movie) {
                $id = (string)$id;
                if (!isset($movieData[$id])) {
                    $movieData[$id] = ['rating' => null, 'screenshots' => []];
                }
                // Always overwrite rating with the latest list's version (last wins)
                if (isset($movie['your-rating']) && $movie['your-rating'] !== '' && $movie['your-rating'] !== '-') {
                    $movieData[$id]['rating'] = $movie['your-rating'];
                }
                if (isset($movie['screenshots'])) {
                    $movieData[$id]['screenshots'] = array_values(
                        array_unique(array_merge($movieData[$id]['screenshots'], $movie['screenshots']))
                    );
                }
            }
        }

        // Now write back the unified data
        $updatedCount = 0;
        foreach ($manifest as $entry) {
            $filePath = getListFilePath($entry['slug'], $listeDir);
            $list = loadList($filePath);
            $changed = false;
            foreach ($list as $id => &$movie) {
                $id = (string)$id;
                if (isset($movieData[$id])) {
                    if ($movieData[$id]['rating'] !== null && (!isset($movie['your-rating']) || $movie['your-rating'] !== $movieData[$id]['rating'])) {
                        $movie['your-rating'] = $movieData[$id]['rating'];
                        $changed = true;
                    }
                    $existingSs = isset($movie['screenshots']) ? $movie['screenshots'] : [];
                    if ($movieData[$id]['screenshots'] !== $existingSs) {
                        $movie['screenshots'] = $movieData[$id]['screenshots'];
                        $changed = true;
                    }
                }
            }
            unset($movie);
            if ($changed) {
                saveList($filePath, $list);
                $updatedCount++;
            }
        }
        echo json_encode(['status' => 'synced', 'lists_updated' => $updatedCount]);
        break;

    default:
        echo json_encode(['error' => 'Unknown action']);
        break;
}
?>
