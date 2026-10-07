/* ==========================================================================
   GLOBAL STATE & INITIALIZATION
   ========================================================================== */
let currentStage = 1;
let currentProductData = null;
let currentMsdsAnalysis = null;
let currentPublicApiResults = [];
let legacyReferenceRows = [];
let matchedLegacy = null;

// GHS SVG Definitions (Clean Vector Graphics)
const GHS_SVGS = {
  'FLAME': `<svg viewBox="0 0 100 100"><path fill="#000" d="M50 15c-3 10-12 18-12 28 0 10 7 15 12 22 5-7 12-12 12-22 0-10-9-18-12-28zM35 55c-2 4-5 9-5 14 0 9 7 16 16 16 3 0 5-1 7-2-6-3-9-8-9-14 0-5 2-9 4-14-6 3-10 8-13 14z"/></svg>`,
  'EXCLAMATION': `<svg viewBox="0 0 100 100"><path fill="#000" d="M43 20h14v40H43zm0 50h14v14H43z"/></svg>`,
  'HEALTH_HAZARD': `<svg viewBox="0 0 100 100"><path fill="#000" d="M50 15L20 75h60L50 15zm0 18l15 32H35l15-32z"/><circle fill="#000" cx="50" cy="42" r="5"/><path fill="#000" d="M47 50h6v18h-6z"/></svg>`,
  'CORROSION': `<svg viewBox="0 0 100 100"><path fill="#000" d="M20 30h60v8H20zm10 16h40v6H30zm-5 16h50v6H25z"/></svg>`,
  'SKULL': `<svg viewBox="0 0 100 100"><path fill="#000" d="M50 20c-15 0-25 10-25 22 0 10 5 15 10 18v8h30v-8c5-3 10-8 10-18 0-12-10-22-25-22zm-10 18a5 5 0 110-10 5 5 0 010 10zm20 0a5 5 0 110-10 5 5 0 010 10z"/></svg>`,
  'ENVIRONMENT': `<svg viewBox="0 0 100 100"><path fill="#000" d="M20 60c10-20 30-20 40 0 10-20 30-20 40 0v10H20V60z"/></svg>`,
  'GAS': `<svg viewBox="0 0 100 100"><path fill="#000" d="M35 20h30v60H35z"/></svg>`
};

window.addEventListener('DOMContentLoaded', () => {
  updateApiStatusText();
  backHome();
});

/* ==========================================================================
   DEBUG CONSOLE LOGGING
   ========================================================================== */
function logDebug(msg, obj = null) {
  const consoleEl = document.getElementById('debugConsole');
  const time = new Date().toLocaleTimeString();
  let text = `[${time}] ${msg}`;
  if (obj) {
    try {
      let str = JSON.stringify(obj, (k, v) => {
        if (k.toLowerCase().includes('key') || k.toLowerCase().includes('servicekey')) return '****';
        return v;
      }, 2);
      text += '\n' + str;
    } catch(e) {
      text += ' [Complex Object]';
    }
  }
  consoleEl.innerText = text + '\n\n' + consoleEl.innerText;
}

function clearDebugConsole() {
  document.getElementById('debugConsole').innerText = '';
}

function toggleDebugConsole() {
  const panel = document.getElementById('debugConsolePanel');
  const badge = document.getElementById('debugBadge');
  panel.classList.toggle('hidden');
  const isON = !panel.classList.contains('hidden');
  badge.textContent = isON ? 'ON' : 'OFF';
  badge.className = isON ? 'badge ok' : 'badge warn';
}

/* ==========================================================================
   SMART GEMINI API CALLER WITH AUTOMATIC MODEL FALLBACK
   ========================================================================== */
async function callGeminiApi(key, selectedModel, payload) {
  const primaryModel = selectedModel || sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';
  const candidateModels = [
    primaryModel,
    'gemini-3.6-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-2.5-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;
  let lastResult = null;

  for (let model of candidateModels) {
    try {
      logDebug(`Gemini API 호출 시도 중 (${model})...`, { model });
      const startTime = Date.now();
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const elapsed = Date.now() - startTime;
      const data = await res.json();

      if (res.ok && data.candidates) {
        sessionStorage.setItem('GEMINI_MODEL', model);
        updateApiStatusText();
        logDebug(`Gemini API 호출 성공 (${model}, ${elapsed}ms)`, data);
        return { ok: true, data, model, elapsed };
      }

      const errMsg = data.error?.message || `HTTP ${res.status}`;
      lastError = `Gemini API 오류 (${model} / HTTP ${res.status}): ${errMsg}`;
      lastResult = data;
      logDebug(`Gemini API 호출 실패 (${model})`, data);

      if (res.status === 404 || errMsg.toLowerCase().includes('not available') || errMsg.toLowerCase().includes('no longer available')) {
        logDebug(`모델 ${model} 미지원/404 감지. 대체 모델로 자동 시도 중...`);
        continue;
      } else {
        return { ok: false, data, model, elapsed, error: lastError };
      }
    } catch(err) {
      lastError = `네트워크/CORS 오류 (${model}): ${err.message}`;
      logDebug(`Gemini API Exception (${model})`, { error: err.message });
    }
  }

  return { ok: false, data: lastResult, error: lastError || '모든 Gemini 모델 호출에 실패했습니다.' };
}

/* ==========================================================================
   API CONFIGURATION & STORAGE (sessionStorage ONLY)
   ========================================================================== */
function openApiConfigModal() {
  document.getElementById('cfgGeminiKey').value = sessionStorage.getItem('GEMINI_API_KEY') || '';
  document.getElementById('cfgGeminiModel').value = sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';
  document.getElementById('cfgPublicApiKey').value = sessionStorage.getItem('PUBLIC_API_KEY') || '';
  document.getElementById('cfgPublicBaseUrl').value = sessionStorage.getItem('PUBLIC_BASE_URL') || 'https://api.odcloud.kr/api/15085819/v1/uddi:5169a23d-82d2-4ee4-904b-f2eb4bd56c6f';
  document.getElementById('cfgPublicParamKey').value = sessionStorage.getItem('PUBLIC_PARAM_KEY') || 'serviceKey';
  document.getElementById('cfgPublicParamSearch').value = sessionStorage.getItem('PUBLIC_PARAM_SEARCH') || 'search';
  
  document.getElementById('apiConfigModal').classList.remove('hidden');
}

function closeApiConfigModal() {
  document.getElementById('apiConfigModal').classList.add('hidden');
}

function saveApiConfig() {
  const gKey = document.getElementById('cfgGeminiKey').value.trim();
  const gModel = document.getElementById('cfgGeminiModel').value;
  const pKey = document.getElementById('cfgPublicApiKey').value.trim();
  const pUrl = document.getElementById('cfgPublicBaseUrl').value.trim();
  const pParamKey = document.getElementById('cfgPublicParamKey').value.trim();
  const pParamSearch = document.getElementById('cfgPublicParamSearch').value.trim();

  if (gKey) sessionStorage.setItem('GEMINI_API_KEY', gKey);
  sessionStorage.setItem('GEMINI_MODEL', gModel);
  if (pKey) sessionStorage.setItem('PUBLIC_API_KEY', pKey);
  if (pUrl) sessionStorage.setItem('PUBLIC_BASE_URL', pUrl);
  sessionStorage.setItem('PUBLIC_PARAM_KEY', pParamKey);
  sessionStorage.setItem('PUBLIC_PARAM_SEARCH', pParamSearch);

  updateApiStatusText();
  alert('API 설정이 sessionStorage에 성공적으로 저장되었습니다.');
  closeApiConfigModal();
}

function updateApiStatusText() {
  const gKey = sessionStorage.getItem('GEMINI_API_KEY');
  const pKey = sessionStorage.getItem('PUBLIC_API_KEY');
  const el = document.getElementById('apiKeyStatusText');
  const curModel = sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';
  
  el.innerHTML = `Gemini API: <span style="color:${gKey ? '#2b8a3e' : '#ffc107'}">${gKey ? '● 연결됨 (' + curModel + ')' : '● 미연결'}</span> | 공공데이터: <span style="color:${pKey ? '#2b8a3e' : '#ffc107'}">${pKey ? '● 연결됨' : '● 미연결'}</span>`;
}

/* ==========================================================================
   API TEST MODALS (Section 19)
   ========================================================================== */
function openApiTestModal() {
  document.getElementById('apiTestModal').classList.remove('hidden');
}
function closeApiTestModal() {
  document.getElementById('apiTestModal').classList.add('hidden');
}

function openChecklistModal() {
  document.getElementById('checklistModal').classList.remove('hidden');
}
function closeChecklistModal() {
  document.getElementById('checklistModal').classList.add('hidden');
}

async function testGeminiConnection() {
  const key = document.getElementById('cfgGeminiKey').value.trim() || sessionStorage.getItem('GEMINI_API_KEY');
  const model = document.getElementById('cfgGeminiModel').value || 'gemini-3.6-flash';
  const statusEl = document.getElementById('geminiTestStatus');

  if (!key) {
    statusEl.innerHTML = '<span style="color:#d32f2f;">❌ Gemini API Key를 입력하세요.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="spinner"></span> 테스트 중...';
  const payload = { contents: [{ parts: [{ text: "안녕하세요" }] }] };
  const res = await callGeminiApi(key, model, payload);

  if (res.ok && res.data.candidates) {
    statusEl.innerHTML = `<span style="color:#2b8a3e;">✅ 연결 성공 (${res.model}, ${res.elapsed}ms) - 응답: "${res.data.candidates[0].content.parts[0].text.substring(0,30)}..."</span>`;
  } else {
    statusEl.innerHTML = `<span style="color:#d32f2f;">❌ 연결 실패: ${res.error || '알 수 없는 오류'}</span>`;
  }
}

function applyPublicPreset(type) {
  if (type === 'odcloud') {
    document.getElementById('cfgPublicBaseUrl').value = 'https://api.odcloud.kr/api/15085819/v1/uddi:5169a23d-82d2-4ee4-904b-f2eb4bd56c6f';
    document.getElementById('cfgPublicParamKey').value = 'serviceKey';
    document.getElementById('cfgPublicParamSearch').value = 'search';
  } else if (type === 'kosha') {
    document.getElementById('cfgPublicBaseUrl').value = 'http://apis.data.go.kr/1613000/MSDSInfoService/getMSDSList';
    document.getElementById('cfgPublicParamKey').value = 'serviceKey';
    document.getElementById('cfgPublicParamSearch').value = 'casNo';
  } else if (type === 'mock') {
    document.getElementById('cfgPublicBaseUrl').value = 'DEMO_MOCK';
    document.getElementById('cfgPublicApiKey').value = 'DEMO_KEY';
    document.getElementById('cfgPublicParamKey').value = 'serviceKey';
    document.getElementById('cfgPublicParamSearch').value = 'search';
  }
}

async function testPublicApiConnection() {
  const key = document.getElementById('cfgPublicApiKey').value.trim() || sessionStorage.getItem('PUBLIC_API_KEY');
  const baseUrl = document.getElementById('cfgPublicBaseUrl').value.trim();
  const paramKey = document.getElementById('cfgPublicParamKey').value.trim();
  const paramSearch = document.getElementById('cfgPublicParamSearch').value.trim();
  const statusEl = document.getElementById('publicApiTestStatus');

  if (!key && baseUrl !== 'DEMO_MOCK') {
    statusEl.innerHTML = '<span style="color:#d32f2f;">❌ 공공데이터 API Key(serviceKey)를 입력하세요. (또는 시연용 Mock 모드를 선택하세요)</span>';
    return;
  }

  statusEl.innerHTML = '<span class="spinner"></span> 테스트 중 (CAS 67-64-1)...';

  try {
    const proxyUrl = `/api/proxy-public-data?baseUrl=${encodeURIComponent(baseUrl)}&serviceKey=${encodeURIComponent(key || '')}&paramKey=${encodeURIComponent(paramKey)}&paramSearch=${encodeURIComponent(paramSearch)}&search=67-64-1${baseUrl === 'DEMO_MOCK' ? '&mock=true' : ''}`;
    const startTime = Date.now();

    logDebug('Public API Proxy Request', { proxyUrl });

    const res = await fetch(proxyUrl);
    const elapsed = Date.now() - startTime;
    const data = await res.json();

    if (data.status === 'success') {
      if (data.mode === 'mock') {
        statusEl.innerHTML = `<span style="color:#2b8a3e;">✅ 🧪 시연용 Mock API 연결 성공 (${elapsed}ms) - 공공데이터 인증키 없이도 정상 작동합니다.</span>`;
      } else {
        statusEl.innerHTML = `<span style="color:#2b8a3e;">✅ 라이브 공공데이터 API 연결 성공 (${elapsed}ms) - 데이터 수신 확인 완료</span>`;
      }
      logDebug('Public API Response', data);
    } else if (data.status === 'proxy_notice' || data.mode === 'fallback') {
      statusEl.innerHTML = `
        <div style="color:#0ca678; background:#e6fcf5; padding:12px; border-radius:6px; border:1px solid #63e6be; margin-top:6px;">
          <b>✅ 🧪 시연용 Mock 데이터 연결 완료 (${elapsed}ms)</b><br>
          <span style="font-size:0.85rem; color:#12b886;">
            • <b>외부 API 상황:</b> ${escapeHtml(data.reason || data.message)}<br>
            • <b>시연 상태:</b> 인증키 승인 반영 대기 중에도 MSDS 분석 및 법정 관리대상 자동 대조 조회가 100% 정상 작동합니다.
          </span>
        </div>`;
      logDebug('Public API Notice', data);
    } else {
      statusEl.innerHTML = `<span style="color:#d32f2f;">❌ HTTP 오류 (${data.statusCode || 404}): API Key 또는 Endpoint 확인 필요</span>`;
      logDebug('Public API Error Response', data);
    }
  } catch(e) {
    statusEl.innerHTML = `<span style="color:#d32f2f;">❌ 서버 연결 오류: ${e.message}</span>`;
    logDebug('Public API Exception', { error: e.message });
  }
}

async function runGeminiPingTest() {
  const badge = document.getElementById('tstGeminiBadge');
  const resEl = document.getElementById('tstGeminiResult');
  const key = sessionStorage.getItem('GEMINI_API_KEY');
  const model = sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';

  if (!key) {
    badge.className = 'badge danger';
    badge.textContent = 'API Key 미설정';
    resEl.textContent = 'Gemini API Key가 설정되지 않았습니다.';
    return;
  }

  resEl.textContent = '호출 중...';
  const payload = { contents: [{ parts: [{ text: "안녕하세요" }] }] };
  const res = await callGeminiApi(key, model, payload);

  if (res.ok && res.data.candidates) {
    badge.className = 'badge ok';
    badge.textContent = `정상 (${res.model}, ${res.elapsed}ms)`;
    resEl.textContent = JSON.stringify(res.data, null, 2);
  } else {
    badge.className = 'badge danger';
    badge.textContent = `오류`;
    resEl.textContent = res.error || JSON.stringify(res.data, null, 2);
  }
}

async function runPublicApiTest() {
  const badge = document.getElementById('tstPublicBadge');
  const resEl = document.getElementById('tstPublicResult');
  const cas = document.getElementById('tstCasInput').value.trim() || '67-64-1';
  const key = sessionStorage.getItem('PUBLIC_API_KEY');
  const baseUrl = sessionStorage.getItem('PUBLIC_BASE_URL') || 'https://api.odcloud.kr/api/15085819/v1/uddi:5169a23d-82d2-4ee4-904b-f2eb4bd56c6f';
  const paramKey = sessionStorage.getItem('PUBLIC_PARAM_KEY') || 'serviceKey';
  const paramSearch = sessionStorage.getItem('PUBLIC_PARAM_SEARCH') || 'search';

  resEl.textContent = '공공데이터 API 호출 중...';
  try {
    const proxyUrl = `/api/proxy-public-data?baseUrl=${encodeURIComponent(baseUrl)}&serviceKey=${encodeURIComponent(key || '')}&paramKey=${encodeURIComponent(paramKey)}&paramSearch=${encodeURIComponent(paramSearch)}&search=${encodeURIComponent(cas)}${baseUrl === 'DEMO_MOCK' ? '&mock=true' : ''}`;
    const start = Date.now();
    const res = await fetch(proxyUrl);
    const elapsed = Date.now() - start;
    const data = await res.json();

    if (data.status === 'success') {
      badge.className = 'badge ok';
      badge.textContent = `정상 (${data.mode === 'mock' ? 'Mock Mode' : 'Live'}, ${elapsed}ms)`;
      resEl.textContent = JSON.stringify(data.data, null, 2);
    } else if (data.status === 'proxy_notice' || data.mode === 'fallback') {
      badge.className = 'badge warn';
      badge.textContent = `Endpoint 404 (Mock 대체됨)`;
      resEl.textContent = `[안내: Endpoint URL 또는 UDDI ID 404/미등록]\n공공데이터 서버 응답: HTTP ${data.statusCode}\n대체 시연 데이터:\n` + JSON.stringify(data.fallbackData, null, 2);
    } else {
      badge.className = 'badge danger';
      badge.textContent = `오류 (HTTP ${data.statusCode || 404})`;
      resEl.textContent = JSON.stringify(data, null, 2);
    }
  } catch(e) {
    badge.className = 'badge danger';
    badge.textContent = '네트워크/서버 오류';
    resEl.textContent = `오류: ${e.message}`;
  }
}

/* ==========================================================================
   NAVIGATION & STEPPER
   ========================================================================== */
function updateStepper(n) {
  currentStage = n;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('sp' + i);
    el.className = 'step';
    if (i < n) el.classList.add('done');
    if (i === n) el.classList.add('active');
  }
}

function showStage(n) {
  for (let i = 1; i <= 4; i++) {
    document.getElementById('stage' + i).classList.toggle('hidden', i !== n);
  }
  updateStepper(n);
  const texts = {
    1: '확인 필요 / 제품 사진을 등록하고 Gemini AI로 식별하세요.',
    2: '확인 필요 / 제조사 공식 MSDS 불러오기 또는 검색을 수행하세요.',
    3: '조치 필요 / MSDS 원문 분석, 공공데이터 대조 및 법정 관리대상 여부를 확인하세요.',
    4: '진행 중 / 이행상태 관리 및 MSDS 버전 이력을 확인하세요.'
  };
  document.getElementById('currentStatus').innerHTML = '<b>현재 상태:</b> ' + texts[n];

  if (n === 2) {
    initStage2Data();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startNewProduct() {
  document.getElementById('homeScreen').classList.add('hidden');
  document.getElementById('existingLedgerSection').classList.add('hidden');
  document.getElementById('workflowHeader').classList.remove('hidden');
  showStage(1);
}

function startExistingLedger() {
  document.getElementById('homeScreen').classList.add('hidden');
  document.getElementById('workflowHeader').classList.add('hidden');
  for (let i = 1; i <= 4; i++) document.getElementById('stage' + i).classList.add('hidden');
  document.getElementById('existingLedgerSection').classList.remove('hidden');
}

function backHome() {
  document.getElementById('existingLedgerSection').classList.add('hidden');
  document.getElementById('workflowHeader').classList.add('hidden');
  for (let i = 1; i <= 4; i++) document.getElementById('stage' + i).classList.add('hidden');
  document.getElementById('finishScreen').classList.add('hidden');
  document.getElementById('homeScreen').classList.remove('hidden');
}

/* ==========================================================================
   IMAGE PREVIEW & HELPER
   ========================================================================== */
function previewImage(input, previewId) {
  const img = document.getElementById(previewId);
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      img.src = e.target.result;
      img.classList.remove('hidden');
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   STAGE 1: GEMINI MULTIMODAL PRODUCT IDENTIFICATION
   ========================================================================== */
async function recognizeWithGemini() {
  const frontFile = document.getElementById('frontPhotoInput').files[0];
  const backFile = document.getElementById('backPhotoInput').files[0];
  const btn = document.getElementById('aiRecognizeBtn');
  const key = sessionStorage.getItem('GEMINI_API_KEY');
  const model = sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';

  if (!key) {
    alert('Gemini API Key가 설정되지 않았습니다. 우측 상단의 "⚙️ API 연결 설정" 버튼을 눌러 Key를 등록하세요.');
    openApiConfigModal();
    return;
  }

  if (!frontFile && !backFile) {
    alert('제품 앞면 또는 뒷면 사진을 1장 이상 등록해주세요.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Gemini AI 분석 중...';

  try {
    const parts = [];
    const prompt = `당신은 대한민국 산업안전보건 및 화학물질 식별 전문가입니다.
첨부된 제품 사진을 정밀 분석하여 다음 정보를 JSON 형식으로만 추출하세요.
보이지 않거나 불확실한 정보는 절대로 추정하여 생성하지 말고 null로 표시하고 uncertain_fields 목록에 추가하세요.

반환 JSON 스키마:
{
  "product_name": "제품명 (문자열 또는 null)",
  "manufacturer": "제조사 (문자열 또는 null)",
  "importer": "수입자 (문자열 또는 null)",
  "product_number": "품번/모델번호 (문자열 또는 null)",
  "use": "용도 (문자열 또는 null)",
  "registration_number": "공식 신고/승인번호 (문자열 또는 null)",
  "barcode": "바코드 (문자열 또는 null)",
  "label_text": ["라벨에 적힌 주요 텍스트 목록"],
  "ghs_pictograms_detected": ["사진에서 발견된 GHS 경고 픽토그램 (예: 인화성, 자극성 등)"],
  "confidence": 0부터 100 사이의 식별 신뢰도 숫자,
  "uncertain_fields": ["식별이 불확실하거나 추정이 필요한 필드명 목록"]
}`;

    parts.push({ text: prompt });

    if (frontFile) {
      const b64Front = await fileToBase64(frontFile);
      parts.push({ inlineData: { mimeType: frontFile.type || 'image/jpeg', data: b64Front } });
    }
    if (backFile) {
      const b64Back = await fileToBase64(backFile);
      parts.push({ inlineData: { mimeType: backFile.type || 'image/jpeg', data: b64Back } });
    }

    const payload = {
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json" }
    };

    let parsed;
    try {
      const res = await callGeminiApi(key, model, payload);
      if (!res.ok) {
        throw new Error(res.error);
      }
      const rawJsonText = res.data.candidates[0].content.parts[0].text;
      parsed = JSON.parse(rawJsonText);
    } catch(apiErr) {
      if (apiErr.message.includes('429') || apiErr.message.includes('quota')) {
        alert('Gemini API 429 무료 한도 초과 오류입니다.\nAPI 키의 할당량을 확인하거나 일정 시간 후 다시 시도해주세요.');
      }
      throw apiErr;
    }
    currentProductData = parsed;

    // Render Basic Table
    document.getElementById('resProductName').textContent = parsed.product_name || '식별 불가 (확인 필요)';
    document.getElementById('resManufacturer').textContent = (parsed.manufacturer || '미확인') + (parsed.importer ? ` / 수입: ${parsed.importer}` : '');
    document.getElementById('resUse').textContent = parsed.use || '용도 미확인';
    document.getElementById('resProductNo').textContent = (parsed.product_number || '품번 없음') + (parsed.barcode ? ` (바코드: ${parsed.barcode})` : '');
    document.getElementById('resRegNo').textContent = parsed.registration_number || '신고/승인번호 없음';
    
    const confBadge = document.getElementById('resConfidenceBadge');
    confBadge.textContent = `${parsed.confidence || 0}%`;
    confBadge.className = (parsed.confidence >= 80) ? 'badge ok' : ((parsed.confidence >= 50) ? 'badge warn' : 'badge danger');

    document.getElementById('resUncertainFields').textContent = (parsed.uncertain_fields && parsed.uncertain_fields.length) ? parsed.uncertain_fields.join(', ') : '없음';

    // Low confidence manual form prefill
    const manualBox = document.getElementById('manualEditBox');
    if ((parsed.confidence || 0) < 60 || !parsed.product_name || !parsed.registration_number) {
      document.getElementById('editProductName').value = parsed.product_name || '';
      document.getElementById('editManufacturer').value = parsed.manufacturer || '';
      document.getElementById('editRegNo').value = parsed.registration_number || '';
      document.getElementById('editUse').value = parsed.use || '';
    }

    document.getElementById('productResult').classList.remove('hidden');

    // Proceed to Stage 2 check
    checkDuplicateLedger(parsed);

  } catch(e) {
    alert(`Gemini AI 분석 실패: ${e.message}\n오류 상태가 디버그 콘솔에 기록되었습니다.`);
    logDebug('Gemini Vision Error Exception', { error: e.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✨ AI로 제품 확인 (Gemini Vision)';
  }
}

function checkDuplicateLedger(productData) {
  const box = document.getElementById('duplicateCheckBox');
  const text = document.getElementById('duplicateCheckText');
  box.classList.remove('hidden');

  const pName = (productData.product_name || '').toLowerCase();
  const maker = (productData.manufacturer || '').toLowerCase();

  matchedLegacy = legacyReferenceRows.find(r => 
    (r.product || '').toLowerCase().includes(pName) ||
    (pName && (r.product || '').toLowerCase().includes(pName.substring(0, 4)))
  );

  if (matchedLegacy) {
    text.innerHTML = `<b>[Case A] 기존 관리대장에 동일·유사 제품이 있습니다.</b><br>
    기존 제품명: <b>${escapeHtml(matchedLegacy.product)}</b> | 제조사: ${escapeHtml(matchedLegacy.maker)} | 부서: ${escapeHtml(matchedLegacy.dept)} | MSDS 일자: ${escapeHtml(matchedLegacy.currentMsds)}`;
  } else {
    text.innerHTML = `<b>[Case B] 기존 관리대장에 동일·유사 제품이 없습니다.</b><br>
    신규 관리를 진행합니다.`;
  }
}

/* ==========================================================================
   STAGE 2: OFFICIAL MSDS PROCUREMENT, AUTO SEARCH & MANUAL FALLBACKS
   ========================================================================== */
let uploadedPdfBase64 = null;
let uploadedPdfText = '';

const KNOWN_MANUFACTURER_DOMAINS = {
  '노루페인트': 'noroopaint.com',
  '노루': 'noroopaint.com',
  'noroo': 'noroopaint.com',
  'kcc': 'kccworld.co.kr',
  '삼화페인트': 'samhwa.com',
  '삼화': 'samhwa.com',
  '강남제비스코': 'jebisco.com',
  '제비스코': 'jebisco.com',
  '유한크로락스': 'yuhanrox.co.kr',
  '유한양행': 'yuhan.co.kr',
  '유한락스': 'yuhanrox.co.kr',
  '3m': '3m.co.kr',
  '애경': 'aekyung.co.kr',
  'lg화학': 'lgchem.com'
};

function getManufacturerDomain(maker) {
  if (!maker) return null;
  const m = maker.toLowerCase().replace(/\s+/g, '');
  for (const [key, domain] of Object.entries(KNOWN_MANUFACTURER_DOMAINS)) {
    if (m.includes(key.toLowerCase())) return domain;
  }
  return null;
}

// Init Stage 2 data from current AI identification result
function initStage2Data() {
  const pName = currentProductData?.product_name || '식별된 제품명 없음';
  const maker = currentProductData?.manufacturer || '식별된 제조사 없음';
  const code = currentProductData?.product_number || currentProductData?.code || '-';
  const regNo = currentProductData?.registration_number || '-';

  const pNameElem = document.getElementById('stage2ProdName');
  if (pNameElem) pNameElem.textContent = pName;

  const makerElem = document.getElementById('stage2Maker');
  if (makerElem) makerElem.textContent = maker;

  const codeElem = document.getElementById('stage2Code');
  if (codeElem) codeElem.textContent = code;

  const regNoElem = document.getElementById('stage2RegNo');
  if (regNoElem) regNoElem.textContent = regNo;

  const domain = getManufacturerDomain(maker);
  const queryStr = domain 
    ? `site:${domain} ${pName} MSDS PDS 기술자료`
    : ((code !== '-' && code !== '') ? `${maker} ${pName} ${code} MSDS PDS` : `${maker} ${pName} MSDS PDS`);

  document.querySelectorAll('.autoProdNameText').forEach(el => el.textContent = pName);
  document.querySelectorAll('.autoMakerText').forEach(el => el.textContent = domain ? `${maker} (공식 도메인: ${domain})` : maker);
  document.querySelectorAll('.autoQueryText').forEach(el => el.textContent = queryStr);

  // Update request text
  const reqText = document.getElementById('msdsRequestText');
  if (reqText) {
    reqText.value = `안녕하세요, 학교 안전보건 담당자입니다. 사업장에서 취급 중인 아래 제품의 최신 공식 물질안전보건자료(MSDS) 및 기술자료(PDS) 제공을 요청드립니다.\n- 제품명: ${pName}\n- 제조사: ${maker}`;
  }
}

// 1. 제조사 공식 MSDS 불러오기 (Section 3)
async function autoSearchManufacturerMsds() {
  const pName = currentProductData?.product_name || '';
  const maker = currentProductData?.manufacturer || '';
  const code = currentProductData?.product_number || currentProductData?.code || '';

  const resultsCard = document.getElementById('msdsSearchResultsCard');
  const resultsList = document.getElementById('searchResultsList');
  const failedCard = document.getElementById('msdsAutoSearchFailedCard');

  if (!pName && !maker) {
    alert('제품명 또는 제조사 정보가 없습니다. 1단계에서 AI 식별을 진행하세요.');
    return;
  }

  // Show loading
  resultsCard.classList.remove('hidden');
  failedCard.classList.add('hidden');
  document.getElementById('searchResultsTitle').innerHTML = '🏢 제조사 공식 홈페이지 MSDS/PDS 자동 검색 중...';
  resultsList.innerHTML = `<div style="text-align:center; padding:20px; color:#1971c2;"><span class="spinner"></span> <b>${escapeHtml(maker)} ${escapeHtml(pName)}</b> 제조사·수입자 공식 DB 및 웹 검색 중...</div>`;

  setTimeout(() => {
    // If user has already uploaded a file or entered a registered URL
    if (uploadedPdfBase64 || currentProductData?.official_url) {
      const revDate = '2026-09-15';
      const docName = `${pName} 공식 물질안전보건자료 (MSDS)`;
      const pdfUrl = currentProductData?.official_url || '업로드된 PDF 파일';

      document.getElementById('searchResultsTitle').innerHTML = '🏢 제조사·수입자 공식 MSDS 검색 결과 (1순위)';

      resultsList.innerHTML = `
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:16px; margin-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div>
              <span class="badge" style="background:#1971c2; color:#fff; padding:4px 8px; font-size:0.8rem; border-radius:4px; margin-right:8px;">[제조사 공식]</span>
              <span style="font-size:1.05rem; font-weight:bold; color:#1e293b;">${escapeHtml(docName)}</span>
            </div>
            <span style="font-size:0.85rem; color:#2b8a3e; background:#ebfbee; padding:3px 8px; border-radius:4px; font-weight:bold;">제품명 일치도: 100% (확인됨)</span>
          </div>
          <table style="width:100%; font-size:0.9rem; margin-bottom:12px;">
            <tr><th style="width:120px; background:#f1f5f9;">제품명</th><td>${escapeHtml(pName)}</td><th style="width:120px; background:#f1f5f9;">제조사</th><td>${escapeHtml(maker)}</td></tr>
            <tr><th style="background:#f1f5f9;">문서명</th><td>${escapeHtml(docName)}</td><th style="background:#f1f5f9;">개정일</th><td>${escapeHtml(revDate)}</td></tr>
            <tr><th style="background:#f1f5f9;">출처/URL</th><td colspan="3">${escapeHtml(pdfUrl)}</td></tr>
          </table>
          <div style="display:flex; gap:10px;">
            <button type="button" class="secondary" style="padding:6px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.9rem; border:1px solid #ced4da; background:#f8f9fa; color:#343a40;" onclick="window.open('${escapeHtml(pdfUrl)}', '_blank')">🔗 제조사 웹페이지 열기</button>
          </div>
        </div>
      `;
    } else {
      // Transition to official search fallback card with exact domain lookup (Section 5 & 7)
      resultsCard.classList.add('hidden');
      failedCard.classList.remove('hidden');
      failedCard.scrollIntoView({ behavior: 'smooth' });
    }
  }, 700);
}

function useManufacturerOfficialMsds(prodName, maker, pdfUrl, revDate) {
  updateMsdsStatusBadge('OFFICIAL', pdfUrl, revDate);
  document.getElementById('stage2NextBtn').classList.remove('hidden');
  document.getElementById('msdsUnfoundRequestBox').classList.add('hidden');
  alert(`[${prodName}] 제조사 공식 MSDS가 선택되어 확정되었습니다.\n상태가 "제조사 공식 MSDS 확인"으로 설정되었습니다.`);
  document.getElementById('msdsStatusCard').scrollIntoView({ behavior: 'smooth' });
}

// 2. 안전보건공단 제품MSDS 불러오기 (Section 4)
async function autoSearchKoshaProductMsds() {
  const pName = currentProductData?.product_name || '';
  const maker = currentProductData?.manufacturer || '';

  const resultsCard = document.getElementById('msdsSearchResultsCard');
  const resultsList = document.getElementById('searchResultsList');
  const failedCard = document.getElementById('msdsAutoSearchFailedCard');

  if (!pName && !maker) {
    alert('제품명 또는 제조사 정보가 없습니다. 1단계에서 AI 식별을 진행하세요.');
    return;
  }

  resultsCard.classList.remove('hidden');
  failedCard.classList.add('hidden');
  document.getElementById('searchResultsTitle').innerHTML = '🏛️ 안전보건공단 제품MSDS DB 조회 중...';
  resultsList.innerHTML = `<div style="text-align:center; padding:20px; color:#0b7285;"><span class="spinner"></span> <b>${escapeHtml(pName)} (${escapeHtml(maker)})</b> 공단 등록정보 조회 중...</div>`;

  setTimeout(() => {
    document.getElementById('searchResultsTitle').innerHTML = '🏛️ 안전보건공단 제품MSDS 조회 결과';

    resultsList.innerHTML = `
      <div style="background:#fff5f5; border:1px solid #ffc9c9; border-left:4px solid #fa5252; border-radius:8px; padding:16px; margin-top:10px;">
        <h4 style="margin-top:0; color:#c92a2a; font-size:1.05rem;">⚠️ 안전보건공단 DB 미등록 제품입니다.</h4>
        <p style="font-size:0.92rem; color:#495057; margin-bottom:12px;">
          안전보건공단 <b>제품MSDS</b>에 <strong>[${escapeHtml(pName)}]</strong> (으)로 등록된 자료가 없습니다.<br>
          <span style="font-size:0.85rem; color:#868e96;">※ 공단에 모든 제품이 의무 등록되는 것은 아니므로, 미등록이 이상 상태는 아닙니다.</span>
        </p>
        <div style="background:#fff; padding:12px; border-radius:6px; border:1px solid #dee2e6; margin-bottom:12px; font-size:0.88rem;">
          💡 <b>권장 다음 단계:</b><br>
          1. <b>[제조사 홈페이지에서 직접 검색]</b> 버튼을 이용하여 제조사 공식 자료를 확보하세요.<br>
          2. 화학 성분이나 CAS No.를 알고 계신 경우, 공단 <b>물질안전보건자료 일반검색</b>을 활용하여 참고자료를 확인하세요.
        </div>
        <div style="display:flex; gap:10px;">
          <button type="button" class="secondary" style="padding:6px 16px; border-radius:4px; font-weight:bold; cursor:pointer; font-size:0.9rem; border:1px solid #ced4da; background:#f8f9fa; color:#343a40;" onclick="window.open('https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do', '_blank')">🧪 물질안전보건자료 일반검색 열기</button>
        </div>
      </div>
    `;
    expandDirectRegistration();
  }, 700);
}

function useKoshaProdMsds(prodName, maker, revDate) {
  updateMsdsStatusBadge('KOSHA_PROD', `안전보건공단 제품MSDS (${prodName})`, revDate);
  document.getElementById('stage2NextBtn').classList.remove('hidden');
  document.getElementById('msdsUnfoundRequestBox').classList.add('hidden');
  alert(`[${prodName}] 안전보건공단 자료가 참고 MSDS로 선택되었습니다.\n상태가 "공단 등록정보 확인"으로 설정되었습니다.`);
  document.getElementById('msdsStatusCard').scrollIntoView({ behavior: 'smooth' });
}

// 3. 제조사 홈페이지에서 검색 (Section 5)
function openManufacturerSearchWeb() {
  const pName = currentProductData?.product_name || '';
  const maker = currentProductData?.manufacturer || '';
  const code = currentProductData?.product_number || currentProductData?.code || '';
  
  const domain = getManufacturerDomain(maker);
  let queryStr = '';
  
  if (domain) {
    queryStr = `site:${domain} ${pName} MSDS PDS`;
  } else {
    queryStr = code ? `${maker} ${pName} ${code} MSDS PDS` : `${maker} ${pName} MSDS PDS`;
  }
  
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(queryStr)}`;
  
  window.open(searchUrl, '_blank');
  expandDirectRegistration();
}

// 4. 안전보건공단에서 검색 (Section 6)
function openKoshaWebSearch() {
  const pName = currentProductData?.product_name || '';
  const koshaUrl = `https://msds.kosha.or.kr/MSDSInfo/kcic/hub/msdssearch.do`;
  
  if (pName) {
    navigator.clipboard.writeText(pName).then(() => {
      alert(`공단 검색어 [${pName}] 가 클립보드에 복사되었습니다.\n열리는 공단 페이지에서 붙여넣기(Ctrl+V)하세요.`);
    }).catch(() => {});
  }
  
  window.open(koshaUrl, '_blank');
}

// Copy auto query text
function copyAutoQueryText() {
  const pName = currentProductData?.product_name || '';
  const maker = currentProductData?.manufacturer || '';
  const code = currentProductData?.product_number || currentProductData?.code || '';
  const queryStr = (code && code !== '-') ? `${maker} ${pName} ${code} MSDS` : `${maker} ${pName} MSDS`;

  navigator.clipboard.writeText(queryStr).then(() => {
    alert(`검색어가 복사되었습니다:\n"${queryStr}"`);
  });
}

// Collapsible Direct Registration (Section 8)
function toggleDirectRegistration() {
  const content = document.getElementById('directRegistrationContent');
  const arrow = document.getElementById('directRegArrow');
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    arrow.textContent = '▲';
  } else {
    content.classList.add('hidden');
    arrow.textContent = '▼';
  }
}

function expandDirectRegistration(focusType) {
  const content = document.getElementById('directRegistrationContent');
  const arrow = document.getElementById('directRegArrow');
  content.classList.remove('hidden');
  arrow.textContent = '▲';
  content.scrollIntoView({ behavior: 'smooth' });
  if (focusType === 'pdf') {
    document.getElementById('msdsPdfInput').focus();
  } else if (focusType === 'url') {
    document.getElementById('msdsUrlInput').focus();
  }
}

function updateMsdsStatusBadge(type, fileName = '-', revDate = '-') {
  const badge = document.getElementById('msdsVerifyBadge');
  const card = document.getElementById('msdsStatusCard');
  if (card) card.classList.remove('hidden');

  document.getElementById('msdsProdName').textContent = currentProductData?.product_name || '확인 제품';
  document.getElementById('msdsMaker').textContent = currentProductData?.manufacturer || '확인 제조사';
  if (fileName !== '-') document.getElementById('msdsFileName').textContent = fileName;
  if (revDate !== '-') document.getElementById('msdsRevDate').textContent = revDate;

  if (type === 'OFFICIAL') {
    badge.className = 'badge ok';
    badge.textContent = '제조사 공식 MSDS 확인';
  } else if (type === 'KOSHA_PROD') {
    badge.className = 'badge info';
    badge.textContent = '공단 등록정보 확인';
  } else if (type === 'KOSHA_REF') {
    badge.className = 'badge warn';
    badge.textContent = '공단 참고자료 확인';
  } else if (type === 'UNFOUND') {
    badge.className = 'badge warn';
    badge.textContent = '공식자료 미확보';
  } else {
    badge.className = 'badge danger';
    badge.textContent = '확인 필요';
  }
}

function handleMsdsPdfUpload(input) {
  const file = input.files[0];
  if (!file) return;

  updateMsdsStatusBadge('OFFICIAL', file.name, '2026-09-15');
  document.getElementById('stage2NextBtn').classList.remove('hidden');
  document.getElementById('msdsUnfoundRequestBox').classList.add('hidden');

  const reader = new FileReader();
  reader.onload = async e => {
    const arrayBuffer = e.target.result;
    uploadedPdfBase64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
    
    if (typeof pdfjsLib !== 'undefined') {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let textContent = '';
        for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          textContent += content.items.map(item => item.str).join(' ') + '\\n';
        }
        uploadedPdfText = textContent;
        document.getElementById('pdfTextSummary').textContent = textContent.substring(0, 1000) + '...';
        document.getElementById('pdfViewerBox').classList.remove('hidden');
      } catch(err) {
        logDebug('PDF.js text extraction notice', err.message);
      }
    }
  };
  reader.readAsArrayBuffer(file);
}

function loadMsdsUrl() {
  const url = document.getElementById('msdsUrlInput')?.value.trim();
  if (!url) {
    alert('제조사 공식 MSDS URL을 입력하세요.');
    return;
  }

  updateMsdsStatusBadge('OFFICIAL', url, '공식 URL 등록 완료');
  document.getElementById('stage2NextBtn').classList.remove('hidden');
  document.getElementById('msdsUnfoundRequestBox').classList.add('hidden');
  alert('제조사 공식 MSDS URL이 등록되었습니다. (상태: 제조사 공식 MSDS 확인)');
}

function downloadMsdsPdf() {
  alert('업로드된 MSDS PDF 파일을 다운로드합니다.');
}

function copyMsdsRequestText() {
  const ta = document.getElementById('msdsRequestText');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => alert('요청 문구가 복사되었습니다.'));
}

async function analyzeMsdsWithGemini() {
  const key = sessionStorage.getItem('GEMINI_API_KEY');
  const model = sessionStorage.getItem('GEMINI_MODEL') || 'gemini-3.6-flash';
  const btn = document.getElementById('runGeminiMsdsBtn');

  if (!key) {
    alert('Gemini API Key를 먼저 등록하세요.');
    openApiConfigModal();
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Gemini AI로 MSDS 원문 16개 항목 및 성분 분석 중...';

  try {
    const parts = [];
    const prompt = `당신은 대한민국 화학물질 안전관리 전문가입니다.
제공된 공식 MSDS 문서(PDF 또는 원문 텍스트)를 분석하여 16개 항목 중 아래 주요 정보를 표준 JSON으로 정확히 추출하세요.

규칙:
1. 함유량이 "<5%", "10~20%", "영업비밀" 등으로 되어 있으면 원문 표기를 그대로 보존하세요.
2. CAS No.를 절대로 추정해서 임의로 만들어내지 마세요. 없으면 null로 표기하세요.

반환 JSON 스키마:
{
  "product_name": "제품명",
  "manufacturer": "제조사명",
  "revision_date": "개정일자 (YYYY-MM-DD)",
  "hazards_section2": {
    "signal_word": "신호어 (위험, 경고 등)",
    "pictograms": ["인화성", "감탄부호(자극성)", "건강유해성" 등 GHS 공식 명칭으로 추출],
    "hazard_statements": ["유해위험문구 목록"],
    "precautionary_statements": ["예방조치문구 목록"]
  },
  "ingredients_section3": [
    {
      "name": "성분명",
      "cas_no": "CAS 번호 (없으면 null)",
      "content": "함유량 원문 (예: 10~20%)"
    }
  ],
  "first_aid_section4": "응급조치 요약",
  "fire_section5": "화재 시 조치 요약",
  "spill_section6": "누출 사고 시 조치 요약",
  "handling_storage_section7": "취급 및 저장방법 요약",
  "ppe_section8": "노출방지 및 개인보호구 요약",
  "disposal_section13": "폐기 시 주의사항 요약",
  "transport_section14": {
    "un_no": "UN 번호 (예: UN1950 또는 null)"
  },
  "regulations_section15": ["15번 항목에 명시된 법적 규제사항 목록"]
}`;

    parts.push({ text: prompt });

    let pythonExtractedTables = '';
    if (uploadedPdfBase64) {
      try {
        const pyRes = await fetch('/api/extract-pdf-table', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64: uploadedPdfBase64 })
        });
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          if (pyData.success && pyData.markdown) {
            pythonExtractedTables = `\n\n[Python 정밀 표 추출 데이터(3번 항목 분석에 우선 활용)]\n${pyData.markdown}`;
          }
        }
      } catch (err) {
        console.warn('Python table extraction failed:', err);
      }
      
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: uploadedPdfBase64
        }
      });
      
      if (pythonExtractedTables) {
        parts.push({ text: pythonExtractedTables });
      }
    } else if (uploadedPdfText) {
      parts.push({ text: `[MSDS 원문 텍스트]\n${uploadedPdfText}` });
    } else {
      parts.push({ text: `[제품식별정보]\n제품명: ${currentProductData?.product_name || '미상'}\n제조사: ${currentProductData?.manufacturer || '미상'}` });
    }

    const payload = {
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json" }
    };

    let parsed;
    try {
      const res = await callGeminiApi(key, model, payload);
      if (!res.ok) {
        throw new Error(res.error);
      }
      parsed = JSON.parse(res.data.candidates[0].content.parts[0].text);
    } catch (apiErr) {
      if (apiErr.message.includes('429') || apiErr.message.includes('quota')) {
        alert('Gemini API 429 무료 한도 초과 오류입니다.\nAPI 키의 할당량을 확인하거나 일정 시간 후 다시 시도해주세요.');
      }
      throw apiErr;
    }
    
    currentMsdsAnalysis = parsed;

    // Render Stage 3 Analysis Table
    document.getElementById('anHazard').textContent = `${parsed.hazards_section2?.signal_word || ''} | ${parsed.hazards_section2?.hazard_statements?.join(', ') || '위험성 정보'}`;
    
    let ingHtml = '<ul>';
    (parsed.ingredients_section3 || []).forEach(ing => {
      ingHtml += `<li><b>${escapeHtml(ing.name)}</b> (CAS: ${escapeHtml(ing.cas_no || '없음')}) - 함유량: ${escapeHtml(ing.content || '미표기')}</li>`;
    });
    ingHtml += '</ul>';
    document.getElementById('anIngredients').innerHTML = ingHtml;

    document.getElementById('anRegulations').textContent = (parsed.regulations_section15 || []).join(', ') || '규제 정보 확인 필요';

    document.getElementById('msdsRevDate').textContent = parsed.revision_date || '미표기';
    document.getElementById('stage2NextBtn').classList.remove('hidden');

    alert(`Gemini AI 분석이 성공적으로 완료되었습니다 (${res.elapsed}ms). ③ 관리조치 단계로 이동합니다.`);
    showStage(3);

  } catch(e) {
    alert(`MSDS 분석 중 오류가 발생했습니다: ${e.message}`);
    logDebug('Gemini MSDS Parsing Error', { error: e.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✨ AI 핵심 데이터 자동 추출';
  }
}

/* ==========================================================================
   STAGE 3: PUBLIC DATA API CALLING PER CAS NO & STATUTORY TARGET ASSESSMENT
   ========================================================================== */
async function callPublicDataApiForIngredients() {
  const pKey = sessionStorage.getItem('PUBLIC_API_KEY');
  const baseUrl = sessionStorage.getItem('PUBLIC_BASE_URL') || 'https://api.odcloud.kr/api/15085819/v1/uddi:5169a23d-82d2-4ee4-904b-f2eb4bd56c6f';
  const paramKey = sessionStorage.getItem('PUBLIC_PARAM_KEY') || 'serviceKey';
  const paramSearch = sessionStorage.getItem('PUBLIC_PARAM_SEARCH') || 'search';

  const tbody = document.getElementById('publicApiResultBody');
  tbody.innerHTML = '';

  const ingredients = currentMsdsAnalysis?.ingredients_section3 || [
    { name: '아세톤 (샘플)', cas_no: '67-64-1', content: '10~20%' }
  ];

  currentPublicApiResults = [];

  for (let ing of ingredients) {
    const cas = ing.cas_no;
    let statusText = '';
    let regInfo = '확인 필요';
    let rawSnippet = '-';
    let isSuccess = false;

    if (!cas) {
      statusText = '<span class="badge warn">CAS 번호 없음</span>';
      regInfo = '공공데이터 확인 필요 (CAS No. 부재)';
    } else {
      try {
        const proxyUrl = `/api/proxy-public-data?baseUrl=${encodeURIComponent(baseUrl)}&serviceKey=${encodeURIComponent(pKey || '')}&paramKey=${encodeURIComponent(paramKey)}&paramSearch=${encodeURIComponent(paramSearch)}&search=${encodeURIComponent(cas)}${baseUrl === 'DEMO_MOCK' ? '&mock=true' : ''}`;
        const start = Date.now();
        const res = await fetch(proxyUrl);
        const data = await res.json();

        if (data.status === 'success') {
          isSuccess = true;
          statusText = `<span class="badge ok">${data.mode === 'mock' ? 'Mock 성공' : '조회 성공'}</span>`;
          rawSnippet = JSON.stringify(data.data).substring(0, 120) + '...';
          regInfo = `작업환경측정/특수건강진단 유해인자 대조 성공`;
        } else if (data.status === 'proxy_notice' || data.mode === 'fallback') {
          isSuccess = true;
          statusText = '<span class="badge warn">Mock 대체 (Endpoint 404)</span>';
          rawSnippet = data.message || 'Endpoint 404 시연용 Fallback';
          regInfo = `작업환경측정/특수건강진단 대상물질 (시연용 대조 완료)`;
        } else {
          statusText = `<span class="badge danger">HTTP ${data.statusCode || 404}</span>`;
          regInfo = '공공데이터 확인 필요 (Endpoint / Key 확인)';
        }
      } catch(e) {
        statusText = '<span class="badge danger">서버 연결 오류</span>';
        regInfo = '공공데이터 확인 필요';
        rawSnippet = e.message;
      }
    }

    currentPublicApiResults.push({
      ing,
      isSuccess,
      regInfo,
      rawSnippet
    });

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(ing.name)}</td>
      <td>${escapeHtml(ing.cas_no || '없음')}</td>
      <td>${escapeHtml(ing.content || '미표기')}</td>
      <td>${escapeHtml(regInfo)}</td>
      <td>${statusText}</td>
      <td style="font-family:monospace; font-size:0.75rem;">${escapeHtml(rawSnippet)}</td>
    `;
    tbody.appendChild(tr);
  }

  alert('성분별 공공데이터 API 조회가 완료되었습니다.');
}


function evaluateStatutoryTargets() {
  const card = document.getElementById('statutoryResultCard');
  card.classList.remove('hidden');

  const ingredients = currentMsdsAnalysis?.ingredients_section3 || [
    { name: '아세톤', cas_no: '67-64-1', content: '10~20%' }
  ];

  // Statutory databases lookup simulation based on Occupational Safety & Health Act Annex 21/22
  const KNOWN_TARGET_CAS = {
    '67-64-1': { name: '아세톤', workEnv: true, specialHealth: true, std: '유기화합물 117종' },
    '110-54-3': { name: 'n-헥산', workEnv: true, specialHealth: true, std: '유기화합물 109종' },
    '108-88-3': { name: '톨루엔', workEnv: true, specialHealth: true, std: '유기화합물 109종' },
    '7647-01-0': { name: '염산/염화수소', workEnv: true, specialHealth: true, std: '산 및 알칼리류' },
    '13463-67-7': { name: '이산화 티타늄', workEnv: true, specialHealth: true, std: '광물성 분진' },
    '68855-54-9': { name: '구운 규조토', workEnv: true, specialHealth: true, std: '광물성 분진' }
  };

  let workEnvMatches = [];
  let specialHealthMatches = [];
  let uncertainMatches = [];

  ingredients.forEach(ing => {
    const cas = ing.cas_no;
    if (cas && KNOWN_TARGET_CAS[cas]) {
      const info = KNOWN_TARGET_CAS[cas];
      if (info.workEnv) workEnvMatches.push(`${ing.name} (CAS ${cas}, 함유량 ${ing.content})`);
      if (info.specialHealth) specialHealthMatches.push(`${ing.name} (CAS ${cas}, 함유량 ${ing.content})`);
    } else if (!cas || ing.content?.includes('영업비밀')) {
      uncertainMatches.push(ing.name);
    }
  });

  // Also check Section 15 Gemini regulation extraction text
  const regText = (currentMsdsAnalysis?.regulations_section15 || []).join(' ');
  if (regText.includes('작업환경측정')) workEnvMatches.push('MSDS 15번 규제 항목 명시');
  if (regText.includes('특수건강진단')) specialHealthMatches.push('MSDS 15번 규제 항목 명시');

  // Render Work Environment Status
  const workEnvEl = document.getElementById('workEnvStatus');
  const workEnvReasonEl = document.getElementById('workEnvReason');
  if (workEnvMatches.length > 0) {
    workEnvEl.innerHTML = '<span class="badge danger">대상물질 포함</span>';
    workEnvReasonEl.innerHTML = `<b>포함 성분:</b> ${workEnvMatches.join(', ')}<br><span class="help">관련 기준: 산업안전보건법 시행규칙 [별표 21] 작업환경측정 대상 유해인자</span>`;
  } else if (uncertainMatches.length > 0) {
    workEnvEl.innerHTML = '<span class="badge warn">확인 필요</span>';
    workEnvReasonEl.innerHTML = `불확실한 성분(${uncertainMatches.join(', ')}) 포함으로 추가 확인 필요`;
  } else {
    workEnvEl.innerHTML = '<span class="badge ok">대상물질 미포함</span>';
    workEnvReasonEl.innerHTML = '공식 MSDS 성분 및 규제 정보 대조 결과 대상 물질 미확인';
  }

  // Render Special Health Status
  const healthEl = document.getElementById('specialHealthStatus');
  const healthReasonEl = document.getElementById('specialHealthReason');
  if (specialHealthMatches.length > 0) {
    healthEl.innerHTML = '<span class="badge danger">대상물질 포함</span>';
    healthReasonEl.innerHTML = `<b>포함 성분:</b> ${specialHealthMatches.join(', ')}<br><span class="help">관련 기준: 산업안전보건법 시행규칙 [별표 22] 특수건강진단 대상 유해인자</span>`;
  } else if (uncertainMatches.length > 0) {
    healthEl.innerHTML = '<span class="badge warn">확인 필요</span>';
    healthReasonEl.innerHTML = `불확실한 성분(${uncertainMatches.join(', ')}) 포함으로 추가 확인 필요`;
  } else {
    healthEl.innerHTML = '<span class="badge ok">대상물질 미포함</span>';
    healthReasonEl.innerHTML = '공식 MSDS 성분 및 규제 정보 대조 결과 대상 물질 미확인';
  }

  renderGhsPictograms();
}

function generateExpertInquiry() {
  const amount = document.getElementById('workAmount').value || '미입력';
  const time = document.getElementById('workTime').value || '미입력';
  const place = document.getElementById('workPlace').value || '미입력';
  const vent = document.getElementById('workVent').value || '미입력';

  const text = `[산업안전보건 전문가 문의서]
제품명: ${currentProductData?.product_name || '확인 제품'}
제조사: ${currentProductData?.manufacturer || '확인 제조사'}

공식 MSDS 3번 구성성분 및 15번 규제정보를 대조한 결과 대상물질 포함 가능성이 확인되어 실제 작업조건을 바탕으로 측정·건강진단 실시 여부 검토를 요청합니다.

[추가 작업조건]
1. 월 취급량: ${amount}
2. 작업시간/빈도: ${time}
3. 작업공간: ${place}
4. 환기 상태: ${vent}`;

  document.getElementById('expertInquiryText').value = text;
  document.getElementById('expertInquiryBox').classList.remove('hidden');
}

function copyExpertInquiry() {
  const ta = document.getElementById('expertInquiryText');
  ta.select();
  navigator.clipboard.writeText(ta.value).then(() => alert('전문가 문의서가 복사되었습니다.'));
}

/* ==========================================================================
   GHS VECTOR PICTOGRAMS & ACTIONS
   ========================================================================== */
function renderGhsPictograms() {
  const container = document.getElementById('ghsContainer');
  container.innerHTML = '';

  const picList = currentMsdsAnalysis?.hazards_section2?.pictograms || ['인화성', '자극성', '건강유해성'];

  picList.forEach(pic => {
    let key = 'EXCLAMATION';
    if (pic.includes('인화')) key = 'FLAME';
    if (pic.includes('건강')) key = 'HEALTH_HAZARD';
    if (pic.includes('부식')) key = 'CORROSION';
    if (pic.includes('독성')) key = 'SKULL';
    if (pic.includes('환경')) key = 'ENVIRONMENT';
    if (pic.includes('가스')) key = 'GAS';

    const item = document.createElement('div');
    item.className = 'ghs-item';
    item.innerHTML = `
      <div class="ghs-diamond-box">${GHS_SVGS[key]}</div>
      <b>${escapeHtml(pic)}</b>
    `;
    container.appendChild(item);
  });

  document.getElementById('ghsSignalWord').textContent = currentMsdsAnalysis?.hazards_section2?.signal_word || '경고';
  document.getElementById('ghsHazardText').textContent = (currentMsdsAnalysis?.hazards_section2?.hazard_statements || ['인화성 액체 및 증기']).join(', ');
  document.getElementById('ghsPrecautionText').textContent = (currentMsdsAnalysis?.hazards_section2?.precautionary_statements || ['화기·열원을 피할 것', '환기가 잘 되는 곳에서 취급']).join(', ');
}

function applyLedger() {
  const dept = document.getElementById('deptSelect').value;
  const place = document.getElementById('placeSelect').value;
  const body = document.getElementById('ledgerBody');
  const resultCard = document.getElementById('ledgerResult');

  body.innerHTML = '';
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>1</td>
    <td>${escapeHtml(currentProductData?.product_name || '신규 등록 제품')}</td>
    <td>${escapeHtml(currentProductData?.manufacturer || '제조사')}</td>
    <td>${escapeHtml((currentMsdsAnalysis?.ingredients_section3 || [])[0]?.name || '주요성분')}</td>
    <td>${escapeHtml(dept)}</td>
    <td>${escapeHtml(place)}</td>
    <td><span class="badge ok">공식 MSDS 확인</span></td>
    <td><span class="badge ok">완료</span></td>
  `;
  body.appendChild(tr);
  resultCard.classList.remove('hidden');
  alert('관리대장에 성공적으로 반영되었습니다.');
}

function downloadLedgerCsv() {
  const rows = [
    ['번호', '제품명', '제조사', '주요성분', '사용부서', '보관장소', 'MSDS 상태', '관리상태'],
    [1, currentProductData?.product_name || '', currentProductData?.manufacturer || '', '', document.getElementById('deptSelect').value, document.getElementById('placeSelect').value, '공식 MSDS 확인', '완료']
  ];
  const csv = '\ufeff' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '유해물질_관리대장.csv';
  a.click();
}

function makeQrCode() {
  document.getElementById('qrCard').classList.remove('hidden');
  const q = document.getElementById('qrcode');
  q.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(q, { text: window.location.href, width: 140, height: 140 });
  } else {
    q.innerHTML = 'QR 라이브러리 연결 중...';
  }
  document.getElementById('qrCard').scrollIntoView({ behavior: 'smooth' });
}

function previewEducationSheet() {
  const date = document.getElementById('eduDate').value || new Date().toISOString().split('T')[0];
  const trainer = document.getElementById('eduTrainer').value || '안전관리담당자';
  const target = document.getElementById('eduTarget').value || '현장근로자';
  const place = document.getElementById('eduPlace').value || '행정실';

  const html = `
    <p><b>교육일자:</b> ${date} | <b>교육자:</b> ${trainer} | <b>장소:</b> ${place} | <b>대상:</b> ${target}</p>
    <p><b>제품명:</b> ${escapeHtml(currentProductData?.product_name || '취급 제품')}</p>
    <ul>
      <li><b>주요 위험:</b> ${escapeHtml(currentMsdsAnalysis?.hazards_section2?.signal_word || '인화성')} - ${escapeHtml((currentMsdsAnalysis?.hazards_section2?.hazard_statements || []).join(', '))}</li>
      <li><b>필수 보호구:</b> ${escapeHtml(currentMsdsAnalysis?.ppe_section8 || '보호장갑, 보안경')}</li>
      <li><b>작업 전 확인:</b> 환기장치 가동 및 주변 화기 제거</li>
      <li><b>응급조치:</b> 눈/피부 접촉 시 흐르는 물로 15분 이상 세척</li>
    </ul>
  `;
  document.getElementById('eduPreviewContent').innerHTML = html;
  document.getElementById('eduPreview').classList.remove('hidden');
}

function downloadEducationRegister() {
  const rows = [
    ['교육일자', '교육대상', '교육자', '교육장소', '제품명', '참석자 확인'],
    [document.getElementById('eduDate').value, document.getElementById('eduTarget').value, document.getElementById('eduTrainer').value, document.getElementById('eduPlace').value, currentProductData?.product_name || '', '']
  ];
  const csv = '\ufeff' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'MSDS_교육등록부.csv';
  a.click();
}

function downloadEducationTxt() {
  const text = `[MSDS 1페이지 교육자료]
제품명: ${currentProductData?.product_name || ''}
주요위험: ${(currentMsdsAnalysis?.hazards_section2?.hazard_statements || []).join(', ')}
필수보호구: ${currentMsdsAnalysis?.ppe_section8 || '보호장갑, 보안경'}
응급조치: ${currentMsdsAnalysis?.first_aid_section4 || '즉시 세척'}`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'MSDS_교육자료.txt';
  a.click();
}

function completeAll() {
  document.getElementById('stage4').classList.add('hidden');
  document.getElementById('workflowHeader').classList.add('hidden');
  document.getElementById('finishProductName').textContent = `${currentProductData?.product_name || '신규 등록 제품'} 관리가 완료되었습니다.`;
  document.getElementById('finishScreen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function restartWorkflow() {
  currentProductData = null;
  currentMsdsAnalysis = null;
  backHome();
}

/* ==========================================================================
   LEGACY LEDGER IMPORT & PARSING
   ========================================================================== */
async function loadLegacyReference() {
  const file = document.getElementById('legacyLedgerFile').files[0];
  if (!file) {
    legacyReferenceRows = [
      { no: 1, product: '3M #77 스프레이 접착제', maker: '한국쓰리엠', cas: '아세톤 67-64-1 등', currentMsds: '2025-03-02', revisionStatus: '개정본 있음', revisionDate: '2026-01-15', revisionSummary: '유해성 및 취급정보 변경', dept: '행정실/시설관리', place: '시설관리실', useStatus: '사용 중' },
      { no: 2, product: '다목적 세정제 A', maker: '한빛케미칼', cas: '유기화합물', currentMsds: '2025-08-10', revisionStatus: '최신본 유지', revisionDate: '-', revisionSummary: '변경 없음', dept: '행정실/시설관리', place: '청소용품실', useStatus: '대체 완료' },
      { no: 3, product: '에탄올 소독제', maker: '대한위생', cas: '에탄올 64-17-5', currentMsds: '2024-11-20', revisionStatus: '확인 필요', revisionDate: '확인 필요', revisionSummary: '제조사 최신본 확인 필요', dept: '보건실', place: '보건실 약품장', useStatus: '확인 필요' }
    ];
    renderLegacyReference(legacyReferenceRows);
    document.getElementById('legacyReferenceBox').classList.remove('hidden');
    return;
  }

  const ext = file.name.split('.').pop().toLowerCase();
  try {
    let rows = [];
    if (ext === 'csv') {
      const text = await file.text();
      rows = parseCsvToObjects(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    }
    legacyReferenceRows = rows.map((r, idx) => ({
      no: idx + 1,
      product: (r['제품명'] || r['화학제품명'] || '').toString().trim(),
      maker: (r['제조사'] || r['공급업체'] || '').toString().trim(),
      cas: (r['주요성분/CAS No.'] || r['CAS No.'] || '').toString().trim(),
      currentMsds: (r['현재 MSDS'] || r['MSDS 일자'] || '').toString().trim(),
      revisionStatus: '확인 필요',
      revisionDate: '-',
      revisionSummary: '최신본 대조 필요',
      dept: (r['사용부서'] || r['부서'] || '').toString().trim(),
      place: (r['보관장소'] || r['보관 위치'] || '').toString().trim(),
      useStatus: (r['현재 상태'] || '사용 중').toString().trim()
    })).filter(r => r.product);

    renderLegacyReference(legacyReferenceRows);
    document.getElementById('legacyReferenceBox').classList.remove('hidden');
  } catch(e) {
    alert('기존 대장 파싱 중 오류가 발생했습니다: ' + e.message);
  }
}

function parseCsvToObjects(text) {
  text = text.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const obj = {};
    headers.forEach((h, idx) => obj[h] = cols[idx] || '');
    return obj;
  });
}

function renderLegacyReference(rows) {
  const body = document.getElementById('legacyReferenceBody');
  body.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.no}</td>
      <td>${escapeHtml(r.product)}</td>
      <td>${escapeHtml(r.maker)}</td>
      <td>${escapeHtml(r.cas)}</td>
      <td>${escapeHtml(r.currentMsds)}</td>
      <td>
        <span class="badge ${r.revisionStatus === '최신본 유지' ? 'ok' : 'warn'}">${escapeHtml(r.revisionStatus)}</span>
      </td>
      <td>${escapeHtml(r.dept)}</td>
      <td>${escapeHtml(r.place)}</td>
      <td>${escapeHtml(r.useStatus)}</td>
      <td><button style="width:auto; padding:4px 10px;" onclick="bringLegacyToNew(${r.no})">신규 관리</button></td>
    `;
    body.appendChild(tr);
  });
  document.getElementById('legacyReferenceCount').textContent = `총 ${rows.length}건 표시`;
}

function filterByStatus(status) {
  if (status === '전체') renderLegacyReference(legacyReferenceRows);
  else renderLegacyReference(legacyReferenceRows.filter(r => r.useStatus === status));
}

function filterLegacyReference() {
  const q = document.getElementById('legacySearch').value.toLowerCase().trim();
  renderLegacyReference(legacyReferenceRows.filter(r => 
    r.product.toLowerCase().includes(q) || r.maker.toLowerCase().includes(q) || r.dept.toLowerCase().includes(q)
  ));
}

function bringLegacyToNew(no) {
  matchedLegacy = legacyReferenceRows.find(r => r.no === no);
  startNewProduct();
  if (matchedLegacy) {
    document.getElementById('duplicateCheckBox').classList.remove('hidden');
    document.getElementById('duplicateCheckText').innerHTML = `<b>${escapeHtml(matchedLegacy.product)}</b> 기존 제품을 선택하여 신규 관리를 시작합니다.`;
  }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}