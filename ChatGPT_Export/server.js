const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const urlModule = require('url');
const { execFile } = require('child_process');
const os = require('os');

const PORT = 3000;
const PUBLIC_DIR = __dirname;

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
  // Enable CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedReqUrl = urlModule.parse(req.url, true);

  // API Proxy Endpoint: /api/proxy-public-data
  if (parsedReqUrl.pathname === '/api/proxy-public-data') {
    const query = parsedReqUrl.query;
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

  // NEW ENDPOINT: /api/extract-pdf-table
  if (parsedReqUrl.pathname === '/api/extract-pdf-table' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const base64Data = payload.pdfBase64;
        
        if (!base64Data) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'pdfBase64 is required' }));
          return;
        }

        // Save base64 to uploads folder for later access via QR
        const fileName = `msds_${Date.now()}.pdf`;
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        const tempFilePath = path.join(uploadDir, fileName);
        fs.writeFileSync(tempFilePath, Buffer.from(base64Data, 'base64'));

        // Run python script
        const scriptPath = path.join(__dirname, 'extract_table.py');
        execFile('python', [scriptPath, tempFilePath], { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
          // Clean up temp file (REMOVED: we need to keep it for QR code access)
          // if (fs.existsSync(tempFilePath)) {
          //   fs.unlinkSync(tempFilePath);
          // }

          if (error) {
            console.error('Python Error:', stderr);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Python script execution failed', details: stderr }));
            return;
          }

          try {
            const result = JSON.parse(stdout);
            result.pdf_url = `/uploads/${fileName}`; // Return the URL of the saved PDF
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
          } catch (parseErr) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Failed to parse python output', output: stdout }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + req.url);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`학교 산업안전보건 MSDS AI 관리 웹앱이 실행되었습니다.`);
  console.log(`접속 URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

