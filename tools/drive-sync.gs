/**
 * My Project → 구글 드라이브 「myproject」 연동
 *
 * 하는 일: 진행 중인 딜의 드라이브 폴더 "바로가기"를 「01_현재 검토 중 프로젝트」에 넣고,
 *          완료·중단·보류 등으로 바뀌면 그 바로가기를 뺀다.
 *          딜 폴더 자체는 당사자별·분야별 위치에 그대로 두고 옮기거나 이름을 바꾸지 않는다.
 *
 * 진행 중 = 앱의 중요·일반 탭(category important/normal)에 있는 딜 (v9.8부터 단계는 보지 않음)
 *
 * 1) 즉시 반영: 앱에서 단계·분류·폴더 주소를 바꾸면 앱이 이 웹 앱을 불러 바로 반영한다.
 * 2) 주 1회 점검: 매주 월요일 새벽 3시 30분(상해 시간)에 data.json 전체와 다시 대조한다.
 * 3) 드라이브 정리 작업함: 매일 새벽 4시 15분(상해 시간)에 GitHub의 tools/drive-ops.json을 읽어,
 *    아직 안 한 작업(폴더 만들기·옮기기·이름 바꾸기·휴지통)을 실행한다. 바로 반영하려면 runDriveOps를 직접 실행.
 *    휴지통은 30일 안에 되살릴 수 있고, 영구 삭제는 하지 않는다.
 *
 * 설치 순서 (LegalTrack 드라이브 연동과 같은 방식, 별도 Apps Script 프로젝트로 만든다)
 *  ① script.google.com → 새 프로젝트 → 이 파일 내용을 붙여 넣고 저장
 *  ② setup 실행 → 권한 허용 (주 1회 예약 + 비밀 키 생성 + 1회 전체 정리)
 *  ③ 배포 → 새 배포 → 유형: 웹 앱 / 다음 사용자로 실행: 나 / 액세스 권한: 모든 사용자 → 배포
 *  ④ showAppLink 실행 → 실행 로그의 주소를 My Project 앱 설정 「드라이브 동기화 주소」에 붙여 넣기
 * 중지하려면: removeTriggers 실행 + 배포 관리에서 웹 앱 보관(삭제)
 *
 * 안전장치
 *  - 「01_현재 검토 중 프로젝트」 안의 바로가기만 만들거나 지운다. 실제 폴더·파일은 건드리지 않는다.
 *  - 이 스크립트가 만든 바로가기에는 설명(description)에 표시를 남기고, 그 표시가 있는 것만 지운다
 *    (사용자가 손으로 만든 바로가기는 그대로 둔다).
 *  - 웹 앱은 비밀 키가 맞을 때만 동작한다.
 *  - 내역은 「01_현재 검토 중 프로젝트」의 '_My Project 동기화 기록' 시트에 남는다.
 */

const DATA_URL = 'https://raw.githubusercontent.com/kjsh1028/myproject/main/data.json';
const ACTIVE_FOLDER_ID = '1kKPgb2Nn3RQGIjBN10J5Xbxzx9BLnjcv'; // myproject/01_현재 검토 중 프로젝트
const MARK = '[myproject-sync]';

/* ── 설치·관리 ── */

function setup() {
  removeTriggers();
  ScriptApp.newTrigger('syncAll').timeBased()
    .everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).nearMinute(30).inTimezone('Asia/Shanghai').create();
  ScriptApp.newTrigger('runDriveOps').timeBased()
    .everyDays(1).atHour(4).nearMinute(15).inTimezone('Asia/Shanghai').create();
  getKey_();
  syncAll();
  runDriveOps();
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncAll' || t.getHandlerFunction() === 'runDriveOps')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  if (!url) { Logger.log('먼저 웹 앱으로 배포하세요 (배포 → 새 배포 → 웹 앱).'); return; }
  Logger.log('My Project 앱 설정 「드라이브 동기화 주소」에 붙여 넣을 주소:\n' + url + '?key=' + getKey_());
  if (/\/dev$/.test(url)) Logger.log('※ 주소가 /dev로 끝나면, 배포 관리 화면의 /exec 주소 뒤에 ?key=' + getKey_() + ' 를 붙여 쓰세요.');
}

function getKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SYNC_KEY', key);
  }
  return key;
}

/* ── 1) 앱에서 바뀌면 즉시 호출: GET ...?key=비밀키&items=폴더ID:1,폴더ID:0 (1=진행 중, 0=아님) ── */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== getKey_()) return json_({ error: '키가 맞지 않습니다' });
  const want = {};
  String(p.items || '').split(',').filter(Boolean).forEach(it => {
    const [folderId, flag] = it.split(':');
    if (folderId) want[folderId] = flag === '1';
  });
  const changed = apply_(want, false);
  return json_({ ok: true, changed: changed });
}

/* ── 2) 주 1회 전체 점검 ── */
function syncAll() {
  const res = UrlFetchApp.fetch(DATA_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    log_([['오류', '', 'GitHub 데이터 읽기 실패: HTTP ' + res.getResponseCode()]]);
    return;
  }
  const data = JSON.parse(res.getContentText('UTF-8'));
  const want = {};
  (data.deals || []).forEach(d => {
    const id = folderIdOf_(d.driveLink);
    if (!id) return;
    // 같은 폴더에 여러 딜이 걸려 있으면 하나라도 진행 중이면 넣는다
    want[id] = !!want[id] || isActive_(d);
  });
  apply_(want, true);
}

/* ── 공통 ── */

function isActive_(d) {
  return d.category === 'important' || d.category === 'normal';  // v9.8부터 단계(stage)는 쓰지 않고 분류만 기준
}

function folderIdOf_(link) {
  const g = /folders\/([\w-]+)/.exec(link || '') || /[?&]id=([\w-]+)/.exec(link || '');
  return g ? g[1] : null;
}

/** want: {폴더ID: true/false}. full=true면 want에 없는 우리 바로가기도 지운다. */
function apply_(want, full) {
  const box = DriveApp.getFolderById(ACTIVE_FOLDER_ID);
  const ours = {}; // targetId → [file]
  const it = box.getFilesByType(MimeType.SHORTCUT);
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const t = f.getTargetId();
    if (!t) continue;
    (ours[t] = ours[t] || []).push(f);
  }
  const rows = [], changed = [];

  Object.keys(want).forEach(folderId => {
    const have = ours[folderId] || [];
    if (want[folderId]) {
      if (have.length) return; // 이미 있음 (손으로 만든 것 포함)
      let target;
      try { target = DriveApp.getFolderById(folderId); } catch (e) { rows.push(['건너뜀', folderId, '폴더를 열 수 없음']); return; }
      if (target.isTrashed()) return;
      const parents = target.getParents();
      if (parents.hasNext() && parents.next().getId() === ACTIVE_FOLDER_ID) return; // 폴더가 이미 이 안에 있음
      const sc = box.createShortcut(folderId);
      sc.setDescription(MARK);
      rows.push(['추가', target.getName(), '바로가기 만듦']);
      changed.push('+' + target.getName());
    } else {
      have.filter(f => (f.getDescription() || '').indexOf(MARK) >= 0).forEach(f => {
        f.setTrashed(true);
        rows.push(['제거', f.getName(), '진행 중 아님']);
        changed.push('-' + f.getName());
      });
    }
  });

  if (full) {
    Object.keys(ours).forEach(t => {
      if (t in want) return;
      ours[t].filter(f => (f.getDescription() || '').indexOf(MARK) >= 0).forEach(f => {
        f.setTrashed(true);
        rows.push(['제거', f.getName(), '앱에서 연결이 없어짐']);
      });
    });
  }
  if (rows.length) log_(rows);
  return changed;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function log_(rows) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LOG_SHEET_ID');
  let ss = null;
  try { if (id) ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('_My Project 동기화 기록');
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(ACTIVE_FOLDER_ID));
    ss.getSheets()[0].appendRow(['일시', '구분', '폴더', '내용']);
    props.setProperty('LOG_SHEET_ID', ss.getId());
  }
  const sh = ss.getSheets()[0];
  const now = Utilities.formatDate(new Date(), 'Asia/Shanghai', 'yyyy-MM-dd HH:mm');
  rows.forEach(r => sh.appendRow([now].concat(r)));
}

/* ── 1회용 폴더 정리: 스크립트 편집기에서 함수를 골라 한 번 실행한다 ──
 * 폴더를 옮기고 이름을 바꾼다(휴지통으로 보내거나 지우지 않음). 이미 옮겨져 있으면 건너뛴다.
 * 결과는 실행 로그와 '_My Project 동기화 기록' 시트에 남는다.
 */

// 2026-11-28: 알렉스 스펙 상장 + SDR 드론 상장 → 「10_진행중/알렉스_SPAC·순돌이드론_미국상장」
function moveAlexSpacDrone() {
  moveFolders_('1FUK5oWXhsY_-BcwAvF0b2D3kNExqVjx6', [
    { id: '1hplu8PKozH7skREql8zb_EJc3XA5HhGk', name: '01_SPAC_Charlton Aria' },
    { id: '1t1QHTyz8nCqVE4V9l__qKqlxd4P5QQKy', name: '02_순돌이(SDR드론)' },
  ]);
}

/** destId 폴더 안으로 items[{id, name}]를 옮기고 이름을 바꾼다. */
function moveFolders_(destId, items) {
  const dest = DriveApp.getFolderById(destId);
  const rows = [];
  items.forEach(it => {
    let f;
    try { f = DriveApp.getFolderById(it.id); } catch (e) { rows.push(['건너뜀', it.id, '폴더를 열 수 없음: ' + e.message]); return; }
    const before = f.getName();
    const parents = f.getParents();
    const from = parents.hasNext() ? parents.next() : null;
    if (from && from.getId() === destId) {
      rows.push(['건너뜀', before, '이미 ' + dest.getName() + ' 안에 있음']);
    } else {
      f.moveTo(dest);
      rows.push(['이동', before, (from ? from.getName() : '?') + ' → ' + dest.getName()]);
    }
    if (it.name && f.getName() !== it.name) {
      f.setName(it.name);
      rows.push(['이름 변경', before, '→ ' + it.name]);
    }
  });
  rows.forEach(r => Logger.log(r.join(' | ')));
  log_(rows);
}


/* ── 3) 드라이브 정리 작업함 (tools/drive-ops.json) ──
 * 형식: {"ops":[
 *   {"id":"고유번호", "op":"mkdir",  "parent":"폴더ID", "name":"새 폴더 이름"},
 *   {"id":"고유번호", "op":"move",   "target":"파일/폴더ID", "to":"폴더ID", "name":"(선택) 새 이름"},
 *   {"id":"고유번호", "op":"rename", "target":"파일/폴더ID", "name":"새 이름"},
 *   {"id":"고유번호", "op":"trash",  "target":"파일/폴더ID"} ]}
 * 한 번 실행한 id는 다시 실행하지 않는다. 결과는 '_My Project 동기화 기록' 시트에 남는다.
 * 안전장치: 본인 소유 항목만 다루고, 지우기는 휴지통 보내기만 한다.
 */
const OPS_URL = 'https://raw.githubusercontent.com/kjsh1028/myproject/main/tools/drive-ops.json';

function runDriveOps() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const res = UrlFetchApp.fetch(OPS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { log_([['오류', 'drive-ops.json', 'HTTP ' + res.getResponseCode()]]); return; }
    const ops = (JSON.parse(res.getContentText('UTF-8')).ops) || [];
    const props = PropertiesService.getScriptProperties();
    const done = JSON.parse(props.getProperty('DONE_OPS') || '[]');
    const me = Session.getEffectiveUser().getEmail();
    const rows = [];
    ops.forEach(o => {
      if (!o || !o.id || done.indexOf(o.id) >= 0) return;
      try {
        rows.push(doOp_(o, me));
      } catch (e) {
        rows.push(['오류', o.id + ' ' + o.op, e.message]);
      }
      done.push(o.id);
    });
    if (rows.length) {
      props.setProperty('DONE_OPS', JSON.stringify(done.slice(-500)));
      rows.forEach(r => Logger.log(r.join(' | ')));
      log_(rows);
    } else {
      Logger.log('새 작업 없음');
    }
  } finally {
    lock.releaseLock();
  }
}

function item_(id) {
  try { return DriveApp.getFolderById(id); } catch (e) { return DriveApp.getFileById(id); }
}

function doOp_(o, me) {
  if (o.op === 'mkdir') {
    const parent = DriveApp.getFolderById(o.parent);
    const it = parent.getFoldersByName(o.name);
    if (it.hasNext()) return ['건너뜀', o.id + ' ' + o.name, '이미 있음 (' + it.next().getId() + ')'];
    const f = parent.createFolder(o.name);
    return ['폴더 만듦', o.id + ' ' + o.name, parent.getName() + ' 안 (' + f.getId() + ')'];
  }
  const t = item_(o.target);
  const owner = t.getOwner();
  if (owner && owner.getEmail() !== me) return ['건너뜀', o.id + ' ' + t.getName(), '본인 소유가 아님'];
  const before = t.getName();
  if (o.op === 'move') {
    const dest = DriveApp.getFolderById(o.to);
    t.moveTo(dest);
    if (o.name && o.name !== before) t.setName(o.name);
    return ['이동', o.id + ' ' + before, '→ ' + dest.getName() + (o.name && o.name !== before ? ' / 이름: ' + o.name : '')];
  }
  if (o.op === 'rename') {
    t.setName(o.name);
    return ['이름 변경', o.id + ' ' + before, '→ ' + o.name];
  }
  if (o.op === 'trash') {
    t.setTrashed(true);
    return ['휴지통', o.id + ' ' + before, '30일 안에 되살릴 수 있음'];
  }
  return ['건너뜀', o.id, '알 수 없는 작업: ' + o.op];
}
