# MSDS 스마트 관리시스템 V2

기존 상위 폴더의 웹페이지를 수정하지 않고 별도로 만든 개선 버전입니다.

## 실행

```powershell
cd msds-v2
npm install
python -m pip install -r requirements.txt
npm start
```

브라우저에서 `http://localhost:3001`로 접속합니다. 기존 버전의 3000번 포트와 동시에 사용할 수 있습니다.

## V2에서 강화된 부분

- 20MB 제한 멀티파트 PDF 업로드와 실제 PDF 서명 검사
- SHA-256 기반 중복 파일 재사용
- 90초 PDF 처리 및 120초 Gemini 호출 타임아웃
- 텍스트형, 혼합형, 스캔형 페이지 진단
- 표와 MSDS 16개 항목 페이지 탐지
- 경고표지나 작업요령 문서를 제품 MSDS로 오인하지 않도록 사전 판별
- Gemini JSON Schema 출력, 응답 구조 검증, CAS 체크디지트 검사
- 결과별 원문 페이지와 근거 문장 표시
- Mock 공공데이터를 법적 판정 성공으로 취급하지 않음

## 선택 사항

스캔 PDF의 로컬 OCR 보조 기능이 필요하면 Tesseract와 한국어/영어 언어팩을 설치합니다. 설치하지 않아도 Gemini의 PDF 원문 비전 분석은 사용할 수 있으며, 로컬 OCR이 필요한 페이지는 화면에 경고로 표시됩니다.

API 키는 기존 화면과의 호환을 위해 브라우저 저장소를 사용합니다. 외부 공개 운영 시에는 Gemini 키를 서버 Secret으로 이동해야 합니다.
