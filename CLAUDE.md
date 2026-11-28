# My Project — 작업 규칙

사용자 개인 딜 관리 앱. `index.html` 하나로 된 PWA(서비스 워커 `sw.js`)이고, 데이터는 이 저장소의 `data.json`에 있다.

## 커밋·푸시
- main 브랜치에 바로 커밋·push한다(앱이 main의 `index.html`·`data.json`을 읽는다).
- 고치기 직전과 push 직전에 `git pull origin main` — 앱이 data.json을 자동 저장하므로 필수.
- 커밋 메시지는 한국어로 쓴다.
- 앱 코드(`index.html`) 변경은 사용자 승인 후 반영하고, 버전 표시(v9.x)를 올린다.

## data.json
- 구조: `deals`, `people`, `deleted`(삭제한 딜 id 목록).
- v9.8부터 딜의 상태는 **분류(`category`: important/normal/hold/drop/closing)만** 쓴다. `stage`는 화면에서 없앴고 기존 값만 남아 있다(새 딜은 빈 값). 진행 중 = 중요·일반.
- 앱은 열 때 id 기준으로 합치며 `updatedAt`이 늦은 쪽을 쓴다 → 딜을 고치면 그 딜의 `updatedAt`을 오늘(YYYY-MM-DD)로 올린다. 다른 딜은 건드리지 않는다.
- 저장은 `json.dump(..., ensure_ascii=False, indent=2)`, 파일 끝 줄바꿈 유지. 커밋 전 `git diff`로 의도한 줄만 바뀌었는지 확인.
- 새 딜 id: `Date.now().toString(36)` + 무작위 3자. 필드는 work-baseline-rules 스킬 2-7장 참고.
- "○○ 진행 기록에 적어 줘" → 그 딜의 `progress`에 `{id, date, content, next, status(진행중·완료·대기·참고), by:"Claude"}` 한 줄 추가.

## 드라이브 연동 (`tools/drive-sync.gs`, Apps Script)
- 진행 중 딜(완료·중단 제외)의 폴더 바로가기를 「01_현재 검토 중 프로젝트」에 자동으로 넣고 뺀다(앱 즉시 호출 + 매일 점검). 폴더 자체는 옮기지 않는다.
- Claude의 드라이브 커넥터는 Claude가 만들지 않은 항목을 옮기거나 지울 수 없다 → **드라이브 정리 작업함** 사용: `tools/drive-ops.json`의 `ops`에 작업을 추가하면 `runDriveOps`가 매일 1회(상해 04:15 = 한국 05:15) 실행한다. 급하면 사용자가 편집기에서 `runDriveOps` 직접 실행.
  - 작업 형식: `{"id","op":"mkdir","parent","name"}`, `{"id","op":"move","target","to","name"?}`, `{"id","op":"rename","target","name"}`, `{"id","op":"trash","target"}`. `note`는 설명용.
  - `id`는 한 번 실행되면 다시 실행되지 않으므로 새 작업에는 새 id를 쓴다. 기존 항목은 지우지 않는다.
  - 휴지통만 허용(영구 삭제 없음), 본인 소유 항목만 처리. 휴지통 작업 전 대상 폴더를 다시 조회해 확인한다.
  - 결과는 드라이브 시트 「_My Project 동기화 기록」(1oh3U5cibYT0SrtdTjTxE5fTEK2qM1SNPIaCtTUWV86o)에 남는다.
- LegalTrack(kjsh1028/Legaltrack)도 같은 방식의 작업함이 있다. 드라이브 정리 요청은 어느 쪽 폴더인지 구분해 해당 저장소의 drive-ops.json에 적는다.

## 세션
- 대화 인계 메모: 드라이브 myproject/세션 인계 폴더(1ATijQ2DSoPDCutFCXWeTXYz_EF6R1V24).
- 설명·보고는 한국어로 한다.
