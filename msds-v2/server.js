const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const Busboy = require('busboy');

const PORT = Number(process.env.MSDS_V2_PORT || 3001);
const PUBLIC_DIR = __dirname;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const PYTHON_TIMEOUT_MS = 90 * 1000;

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8'
};

// Sample Mock MSDS Regulatory Data for Demonstration Fallback
const MOCK_CHEMICAL_DATABASE = {
  '67-64-1': {
    name: '아세톤 (Acetone)',
    cas_no: '67-64-1',
    work_environment_target: true,
    special_health_target: true,
    controlled_hazardous: true,
    exposure_limit_ppm: 500,
    regulations: '산업안전보건법 작업환경측정 대상 유해인자, 특수건강진단 대상 유해인자, 관리대상 유해물질',
    source: '공공데이터 샘플 데이터베이스 (Mock API)'
  },
  '64-17-5': {
    name: '에탄올 (Ethanol)',
    cas_no: '64-17-5',
    work_environment_target: false,
    special_health_target: false,
    controlled_hazardous: false,
    exposure_limit_ppm: 1000,
    regulations: '산업안전보건법 노출기준 설정물질',
    source: '공공데이터 샘플 데이터베이스 (Mock API)'
  },
  '1330-20-7': {
    name: '크실렌 (Xylene)',
    cas_no: '1330-20-7',
    work_environment_target: true,
    special_health_target: true,
    controlled_hazardous: true,
    exposure_limit_ppm: 100,
    regulations: '산업안전보건법 작업환경측정 대상, 특수건강진단 대상, 관리대상 유해물질',
    source: '공공데이터 샘플 데이터베이스 (Mock API)'
  }
};

const server = http.createServer((req, res) => {
  // V2 only allows browser calls from this server's own origin.
  const requestOrigin = req.headers.origin;
  if (requestOrigin) {
    try {
      if (new URL(requestOrigin).host === req.headers.host) {
        res.setHeader('Access-Control-Allow-Origin', requestOrigin);
        res.setHeader('Vary', 'Origin');
      }
    } catch (_) {}
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedReqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // API Proxy Endpoint: /api/proxy-public-data
  if (parsedReqUrl.pathname === '/api/proxy-public-data') {
    const query = Object.fromEntries(parsedReqUrl.searchParams.entries());
    const baseUrl = query.baseUrl || 'https://api.odcloud.kr/api/15085819/v1/uddi:5169a23d-82d2-4ee4-904b-f2eb4bd56c6f';
    const serviceKey = query.serviceKey || '';
    const paramKey = query.paramKey || 'serviceKey';
    const paramSearch = query.paramSearch || 'search';
    const searchValue = query.search || query.cas || '67-64-1';
    const isMock = query.mock === 'true' || query.useMock === 'true' || baseUrl === 'DEMO_MOCK';

    // Mock Mode requested or fallback
    if (isMock || searchValue === 'DEMO_MOCK' || !baseUrl || baseUrl === 'DEMO_MOCK') {
      const mockResult = MOCK_CHEMICAL_DATABASE[searchValue] || {
        name: `화학물질 (CAS: ${searchValue})`,
        cas_no: searchValue,
        work_environment_target: true,
        special_health_target: false,
        regulations: '공공데이터 시연용 가상 데이터',
        source: '공공데이터 샘플 데이터베이스 (Mock Mode)'
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'success',
        mode: 'mock',
        currentCount: 1,
        data: [mockResult],
        message: '시연용 공공데이터 Mock API로 정상 응답되었습니다.'
      }));
      return;
    }
    // Build URL for external API call
    let fullTargetUrl = baseUrl;
    const hasQuery = baseUrl.includes('?');
    const separator = hasQuery ? '&' : '?';

    // Support data.go.kr standard params (_type=json, pageNo, numOfRows)
    let queryParams = `page=1&perPage=5&pageNo=1&numOfRows=5&_type=json&${paramSearch}=${encodeURIComponent(searchValue)}`;

    if (serviceKey) {
      // Avoid double-encoding if key is already URL-encoded
      let decodedKey = serviceKey;
      try {
        if (serviceKey.includes('%')) decodedKey = decodeURIComponent(serviceKey);
      } catch(e) {}
      queryParams += `&${paramKey}=${encodeURIComponent(decodedKey)}`;
    }

    fullTargetUrl = `${baseUrl}${separator}${queryParams}`;

    const client = fullTargetUrl.startsWith('https') ? https : http;

    client.get(fullTargetUrl, { headers: { 'Accept': 'application/json, application/xml, text/plain' } }, (proxyRes) => {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        let jsonBody = null;
        try { jsonBody = JSON.parse(body); } catch(e) {}

        const isAuthError = body.includes('NO_OPENAPI_SERVICE_ERROR') || body.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR') || body.includes('returnAuthMsg');

        if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300 && !isAuthError) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'success',
            mode: 'live',
            statusCode: proxyRes.statusCode,
            data: jsonBody?.data || jsonBody?.response?.body?.items || jsonBody || body,
            raw: jsonBody || body
          }));
        } else {
          // Diagnostic Reason
          let diagReason = `공공데이터 서버 응답 (HTTP ${proxyRes.statusCode})`;
          if (body.includes('SERVICE_KEY_IS_NOT_REGISTERED_ERROR') || body.includes('등록되지 않은')) {
            diagReason = '공공데이터포털 인증키 반영 대기 중이거나(신청 후 1~2시간 소요) Key의 인코딩/디코딩 형식이 다릅니다.';
          } else if (body.includes('NO_OPENAPI_SERVICE_ERROR')) {
            diagReason = '공공데이터포털에서 해당 API 서비스 경로가 변경되었거나 점검 중입니다.';
          } else if (proxyRes.statusCode === 404) {
            diagReason = '지정한 API Endpoint URL 또는 dataset ID가 서버에 존재하지 않거나 404 상태입니다.';
          }

          const mockFallback = MOCK_CHEMICAL_DATABASE[searchValue] || MOCK_CHEMICAL_DATABASE['67-64-1'];
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            status: 'proxy_notice',
            mode: 'fallback',
            statusCode: proxyRes.statusCode,
            reason: diagReason,
            apiError: jsonBody || body.substring(0, 200),
            fallbackData: [mockFallback],
            message: `${diagReason} 시연용 Mock 데이터로 안전하게 자동 전환되었습니다.`
          }));
        }
      });
    }).on('error', (err) => {
      const mockFallback = MOCK_CHEMICAL_DATABASE[searchValue] || MOCK_CHEMICAL_DATABASE['67-64-1'];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'proxy_error',
        mode: 'fallback',
        error: err.message,
        fallbackData: [mockFallback],
        message: `네트워크 연결 오류 (${err.message}). 시연용 Mock 데이터로 자동 처리되었습니다.`
      }));
    });
    return;
  }
  
  // NEW ENDPOINT: /api/get-ip
  if (parsedReqUrl.pathname === '/api/get-ip' && req.method === 'GET') {
    const interfaces = os.networkInterfaces();
    let lanIp = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          lanIp = iface.address;
          break;
        }
      }
      if (lanIp !== '127.0.0.1') break;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ip: lanIp }));
    return;
  }

  // V2 ENDPOINT: bounded multipart upload + deduplicated PDF extraction
  if (parsedReqUrl.pathname === '/api/extract-pdf-table' && req.method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      sendJson(res, 415, { success: false, error: 'Expected a multipart PDF upload.' });
      return;
    }

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_PDF_BYTES, fields: 2, parts: 3 }
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: 'Invalid upload request.' });
      return;
    }

    const chunks = [];
    let fileInfo = null;
    let fileTooLarge = false;
    let receivedFile = false;
    let requestFailed = false;

    busboy.on('file', (fieldName, file, info) => {
      if (fieldName !== 'pdf' || receivedFile) {
        file.resume();
        return;
      }
      receivedFile = true;
      fileInfo = info;
      file.on('data', chunk => chunks.push(chunk));
      file.on('limit', () => { fileTooLarge = true; });
      file.on('error', () => { requestFailed = true; });
    });

    busboy.on('error', error => {
      requestFailed = true;
      sendJson(res, 400, { success: false, error: `Upload failed: ${error.message}` });
    });

    busboy.on('finish', async () => {
      if (res.writableEnded || requestFailed) return;
      if (!receivedFile) {
        sendJson(res, 400, { success: false, error: 'No PDF file was received.' });
        return;
      }
      if (fileTooLarge) {
        sendJson(res, 413, { success: false, error: 'The PDF exceeds the 20MB limit.' });
        return;
      }

      const pdfBuffer = Buffer.concat(chunks);
      const header = pdfBuffer.subarray(0, Math.min(1024, pdfBuffer.length)).toString('latin1');
      if (!header.includes('%PDF-')) {
        sendJson(res, 415, { success: false, error: 'The uploaded file is not a valid PDF.' });
        return;
      }
      if (fileInfo?.mimeType && fileInfo.mimeType !== 'application/pdf') {
        sendJson(res, 415, { success: false, error: 'The uploaded MIME type is not application/pdf.' });
        return;
      }

      const digest = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
      const fileName = `msds_${digest.slice(0, 20)}.pdf`;
      const uploadDir = path.join(__dirname, 'uploads');
      const savedPath = path.join(uploadDir, fileName);
      let duplicateReused = true;

      try {
        await fs.promises.mkdir(uploadDir, { recursive: true });
        try {
          await fs.promises.access(savedPath, fs.constants.F_OK);
        } catch (_) {
          duplicateReused = false;
          await fs.promises.writeFile(savedPath, pdfBuffer, { flag: 'wx' });
        }
      } catch (error) {
        sendJson(res, 500, { success: false, error: `PDF storage failed: ${error.message}` });
        return;
      }

      const scriptPath = path.join(__dirname, 'extract_table.py');
      const pythonCommand = process.env.MSDS_PYTHON || 'python';
      execFile(
        pythonCommand,
        ['-X', 'utf8', scriptPath, savedPath],
        { maxBuffer: 5 * 1024 * 1024, timeout: PYTHON_TIMEOUT_MS, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            const timedOut = error.killed || error.code === 'ETIMEDOUT';
            console.error('PDF extraction failed:', stderr || error.message);
            sendJson(res, timedOut ? 504 : 422, {
              success: false,
              error: timedOut ? 'PDF extraction exceeded 90 seconds.' : 'PDF structure extraction failed.',
              details: (stderr || error.message).slice(0, 1000),
              pdf_url: `/uploads/${fileName}`
            });
            return;
          }

          try {
            const result = JSON.parse(stdout.trim());
            if (!result.success) {
              sendJson(res, 422, { ...result, pdf_url: `/uploads/${fileName}` });
              return;
            }
            sendJson(res, 200, {
              ...result,
              pdf_url: `/uploads/${fileName}`,
              duplicate_reused: duplicateReused,
              sha256: digest
            });
          } catch (parseError) {
            sendJson(res, 500, {
              success: false,
              error: 'Could not parse the PDF extraction result.',
              details: parseError.message,
              pdf_url: `/uploads/${fileName}`
            });
          }
        }
      );
    });

    req.pipe(busboy);
    return;
  }

  // Static File Serving with traversal protection
  let requestPath;
  try {
    requestPath = decodeURIComponent(parsedReqUrl.pathname || '/');
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^[/\\]+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  const safeRoot = path.resolve(PUBLIC_DIR) + path.sep;
  if (!filePath.startsWith(safeRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + req.url);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`학교 산업안전보건 MSDS AI 관리 웹앱이 실행되었습니다.`);
  console.log(`접속 URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

