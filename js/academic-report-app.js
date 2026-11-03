// js/academic-report-app.js
// Staff-only interactive viewer for the MedQuiz KKU 2026 academic report (R0-R3).
// Holds NO live stems, keys, or student names in source: loads from RTDB `academic_report_2026`
// after requireStaff(user), from a local JSON file dropped by the user, or from synthetic fixture data.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (head, rows) => '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

let data = null;
let activeTab = 'overview';

export function buildFixtureReport() {
    const mkItems = (n, prefix, pts) => Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i + 1}`, type: i % 3 === 0 ? 'MTF' : 'MCQ', pts,
        key: i % 3 === 0 ? 'TRUE' : 'ABCDE'[i % 5],
        diff: +((20 + ((i * 19) % 75))).toFixed(1),
        disc: +((0.12 + ((i * 7) % 45) / 100)).toFixed(3),
        mean: +(((20 + ((i * 19) % 75)) / 100) * pts).toFixed(2),
        n: 40, status: 'นับคะแนน', stem: `FIXTURE โจทย์ตัวอย่างข้อ ${prefix}${i + 1}`
    }));
    const teams = Array.from({ length: 12 }, (_, t) => ({
        rank: t + 1, team_id: `MQ0${String(t + 1).padStart(2, '0')}`,
        team_name: `ทีมตัวอย่าง ${t + 1}`, school: 'โรงเรียนทดสอบ',
        total: 28 - t, cells: Array.from({ length: 10 }, (__, q) => ((t + q) % 3 === 0 ? 0 : 1))
    }));
    return {
        generatedAt: 'FIXTURE',
        rounds: {
            r0: { title: 'รอบที่ 0 — ข้อสอบคัดเลือก (ออนไลน์)', participants: 817, items: mkItems(12, 'R0-', 3), matrixHead: ['อันดับ', 'รหัสทีม', 'ชื่อทีม', 'โรงเรียน', 'รวม'], matrixRows: teams.map((t) => [t.rank, t.team_id, t.team_name, t.school, t.total]) },
            r1: { title: 'รอบที่ 1 — KKUEXAM (MCQ+MTF & Unseen)', participants: 278, items: mkItems(12, 'R1-', 1), matrixHead: ['รหัสทีม', 'คนที่', 'คะแนน /28'], matrixRows: teams.map((t) => [t.team_id, 1, t.total]) },
            r2: { title: 'รอบที่ 2 — Spot (40 ทีม × 35 ข้อ)', participants: 40, items: mkItems(10, 'ข้อ ', 1), heatTeams: teams.map((t) => t.team_id), heatMatrix: Array.from({ length: 10 }, (_, q) => teams.map((t) => t.cells[q])), matrixHead: ['อันดับ', 'รหัสทีม', 'ชื่อทีม', 'รวม'], matrixRows: teams.map((t) => [t.rank, t.team_id, t.team_name, t.total]) },
            r3: { title: 'รอบที่ 3 — Gameshow (8 ทีมสุดท้าย)', participants: 8, items: mkItems(8, 'GS-', 1), matrixHead: ['อันดับ', 'รหัสทีม', 'ชื่อทีม', 'ช่องบนกระดาน'], matrixRows: teams.slice(0, 8).map((t) => [t.rank, t.team_id, t.team_name, 9 - t.rank]) }
        }
    };
}

function roundStats(r) {
    const it = (r && r.items) || [];
    const n = it.length || 1;
    const avgDiff = (it.reduce((a, x) => a + Number(x.diff || 0), 0) / n).toFixed(1);
    const avgDisc = (it.reduce((a, x) => a + Number(x.disc || 0), 0) / n).toFixed(3);
    const hard = it.filter((x) => Number(x.diff) < 30).length;
    const mid = it.filter((x) => Number(x.diff) >= 30 && Number(x.diff) <= 70).length;
    const easy = it.filter((x) => Number(x.diff) > 70).length;
    return { count: it.length, avgDiff, avgDisc, hard, mid, easy };
}

function renderOverview() {
    const rds = data.rounds || {};
    const keys = ['r0', 'r1', 'r2', 'r3'].filter((k) => rds[k]);
    $('kpiGrid').innerHTML = keys.map((k) => {
        const r = rds[k]; const s = roundStats(r);
        return `<div class="bg-white border border-slate-200 rounded-xl p-4">
            <div class="text-xs text-slate-500">${esc(r.title)}</div>
            <div class="text-2xl font-bold text-[#0f1f4b] mt-1">${s.count} ข้อ · ${esc(r.participants)} ทีม/คน</div>
            <div class="text-xs text-slate-600 mt-1">% ตอบถูกเฉลี่ย <b>${s.avgDiff}%</b> · Disc. เฉลี่ย <b>${s.avgDisc}</b></div>
        </div>`;
    }).join('');
    $('roundSummaryTable').innerHTML = `<table class="w-full text-xs">
        <thead class="bg-slate-100"><tr><th class="p-2 text-left">รอบ</th><th class="p-2 text-right">ผู้เข้าสอบ</th><th class="p-2 text-right">จำนวนข้อ</th><th class="p-2 text-right">% ตอบถูกเฉลี่ย</th><th class="p-2 text-right">Disc. เฉลี่ย</th><th class="p-2 text-right">ยาก (&lt;30%)</th><th class="p-2 text-right">กลาง (30–70%)</th><th class="p-2 text-right">ง่าย (&gt;70%)</th></tr></thead>
        <tbody>${keys.map((k) => {
            const r = rds[k]; const s = roundStats(r);
            return `<tr class="border-t"><td class="p-2 font-semibold">${esc(r.title)}</td><td class="p-2 text-right">${esc(r.participants)}</td><td class="p-2 text-right">${s.count}</td><td class="p-2 text-right">${s.avgDiff}%</td><td class="p-2 text-right">${s.avgDisc}</td><td class="p-2 text-right text-red-700">${s.hard}</td><td class="p-2 text-right text-amber-700">${s.mid}</td><td class="p-2 text-right text-emerald-700">${s.easy}</td></tr>`;
        }).join('')}</tbody></table>`;
}

function renderRound(key) {
    const r = (data.rounds || {})[key];
    if (!r) return;
    $('roundTitle').textContent = r.title;
    const s = roundStats(r);
    $('distBars').innerHTML = [
        ['ยาก (< 30%)', s.hard, 'bg-red-100 text-red-900'],
        ['ปานกลาง (30–70%)', s.mid, 'bg-amber-100 text-amber-900'],
        ['ง่าย (> 70%)', s.easy, 'bg-emerald-100 text-emerald-900']
    ].map(([lbl, c, cls]) => `<div class="rounded-lg p-2.5 ${cls} flex justify-between"><span>${lbl}</span><b>${c} ข้อ</b></div>`).join('');

    const q = ($('itemSearch').value || '').trim().toLowerCase();
    const band = $('bandFilter').value;
    const items = (r.items || []).filter((it) => {
        if (band === 'hard' && !(Number(it.diff) < 30)) return false;
        if (band === 'mid' && !(Number(it.diff) >= 30 && Number(it.diff) <= 70)) return false;
        if (band === 'easy' && !(Number(it.diff) > 70)) return false;
        if (!q) return true;
        return [it.id, it.type, it.key, it.status, it.stem].some((v) => String(v || '').toLowerCase().includes(q));
    });
    $('itemsTable').innerHTML = `<table class="w-full text-xs">
        <thead class="bg-slate-100"><tr><th class="p-2 text-left">ข้อ</th><th class="p-2 text-left">รูปแบบ</th><th class="p-2 text-right">เต็ม</th><th class="p-2 text-left">เฉลย</th><th class="p-2 text-right">% ตอบถูก</th><th class="p-2 text-right">Disc.</th><th class="p-2 text-right">เฉลี่ย</th><th class="p-2 text-right">N</th><th class="p-2 text-left">โจทย์ / หมายเหตุ</th></tr></thead>
        <tbody>${items.map((it) => {
            const d = Number(it.diff || 0);
            const rowCls = d < 30 ? 'bg-red-50/60' : d > 70 ? 'bg-emerald-50/60' : '';
            return `<tr class="border-t ${rowCls}"><td class="p-2 font-bold whitespace-nowrap">${esc(it.id)}</td><td class="p-2 whitespace-nowrap">${esc(it.type)}</td><td class="p-2 text-right">${esc(it.pts)}</td><td class="p-2 font-bold text-emerald-800">${esc(it.key)}</td><td class="p-2 text-right font-semibold">${d.toFixed(1)}%</td><td class="p-2 text-right">${esc(it.disc)}</td><td class="p-2 text-right">${esc(it.mean)}</td><td class="p-2 text-right">${esc(it.n)}</td><td class="p-2 max-w-[520px]">${esc(it.stem || it.status || '')}</td></tr>`;
        }).join('')}</tbody></table>`;

    const hasHeat = Array.isArray(r.heatTeams) && Array.isArray(r.heatMatrix);
    $('heatCard').hidden = !hasHeat;
    if (hasHeat) {
        const box = $('heatGrid');
        box.style.gridTemplateColumns = `3.2rem repeat(${r.heatTeams.length}, minmax(0, 1fr))`;
        const cells = ['<div></div>'].concat(r.heatTeams.map((t) => `<div class="text-[9px] text-center text-slate-500 truncate" title="${esc(t)}">${esc(String(t).replace(/^MQ/, ''))}</div>`));
        r.heatMatrix.forEach((row, qi) => {
            const it = (r.items || [])[qi] || { id: qi + 1 };
            cells.push(`<div class="text-[10px] text-right pr-1 text-slate-600">${esc(it.id)}</div>`);
            row.forEach((v, ti) => {
                const c = v === null || v === '' ? 'bg-slate-200' : Number(v) >= 1 ? 'bg-emerald-500' : Number(v) > 0 ? 'bg-amber-400' : 'bg-red-500';
                cells.push(`<div class="h-3 rounded-sm ${c}" title="${esc(it.id)} · ${esc(r.heatTeams[ti])} = ${v ?? '-'}"></div>`);
            });
        });
        box.innerHTML = cells.join('');
    }

    const tq = ($('teamSearch').value || '').trim().toLowerCase();
    const mhead = r.matrixHead || [];
    const mrows = (r.matrixRows || []).filter((row) => !tq || row.slice(0, 5).some((c) => String(c ?? '').toLowerCase().includes(tq)));
    $('matrixTitle').textContent = `ตารางคะแนน (${mrows.length} / ${(r.matrixRows || []).length} แถว)`;
    $('matrixTable').innerHTML = `<table class="w-full text-xs"><thead class="bg-slate-100 sticky top-0"><tr>${mhead.map((h) => `<th class="p-1.5 text-left whitespace-nowrap">${esc(h)}</th>`).join('')}</tr></thead><tbody>${mrows.map((row) => `<tr class="border-t">${row.map((c, i) => `<td class="p-1.5 ${i >= 3 ? 'text-right' : ''} whitespace-nowrap">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function render() {
    if (!data) return;
    if (!fileCatalog.length) buildFileCatalog();
    $('statusLine').textContent = `ข้อมูลรายงานเมื่อ: ${data.generatedAt || '-'} · เอกสารภายในฝ่ายวิชาการ ห้ามเผยแพร่`;
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('tab-on', b.dataset.tab === activeTab));
    const isOv = activeTab === 'overview';
    $('viewOverview').hidden = !isOv;
    $('viewRound').hidden = isOv;
    if (isOv) renderOverview(); else renderRound(activeTab);
}

function downloadBlob(name, text, mime = 'text/csv;charset=utf-8') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let fileCatalog = [];

function buildFileCatalog() {
    const rds = data.rounds || {};
    const list = [];
    // JSON bundle
    list.push({ name: 'academic_report_web.json', desc: 'ชุดข้อมูลทั้งหมด (JSON)', kind: 'json', icon: 'fa-code' });
    // HTML standalone
    list.push({ name: 'full_academic_report_2026.html', desc: 'รายงานฉบับเต็ม (HTML standalone)', kind: 'html', icon: 'fa-file-code' });
    // CSV per round
    // split R1 items: MCQ+MTF vs Unseen by type prefix
    function splitR1(r1) {
        if (!r1) return { mcqMtf: null, unseen: null };
        const all = r1.items || [];
        const mcqMtfItems = all.filter((it) => /^(MCQ|MTF)/.test(it.type));
        const unseenItems = all.filter((it) => /^Unseen/.test(it.type));
        // Matrix has 46 cols: 3 metadata + 43 MCQ+MTF item scores. Unseen NOT in matrix.
        return {
            mcqMtf: mcqMtfItems.length ? {
                label: 'รอบ 1 MCQ+MTF', participants: r1.participants,
                items: mcqMtfItems,
                matrixHead: r1.matrixHead || [],
                matrixRows: r1.matrixRows || []
            } : null,
            unseen: unseenItems.length ? {
                label: 'รอบ 1 Unseen', participants: r1.participants,
                title: 'รอบที่ 1 — Unseen (3 บทความ × 8 T/F)',
                items: unseenItems,
                matrixHead: [],
                matrixRows: []
            } : null
        };
    }

    const r1Split = splitR1(rds.r1);

    const csvRounds = [
        { key: 'r0', label: 'รอบ 0', statsFile: 'r0_item_stats.csv', matrixFile: 'r0_team_item_matrix.csv',
          final100File: 'r0_final100_item_matrix.csv' },
        { key: 'r1mcq', label: 'รอบ 1 MCQ+MTF', statsFile: 'r1_mcq_mtf_item_stats.csv', matrixFile: 'r1_mcq_mtf_person_item_matrix.csv',
          source: r1Split.mcqMtf, matrixOk: true },
        { key: 'r1u', label: 'รอบ 1 Unseen', statsFile: 'r1_unseen_item_stats.csv', matrixFile: 'r1_unseen_person_item_matrix.csv',
          source: r1Split.unseen, matrixOk: false },
        // unseen matrix: items exist but matrix rows not in web JSON — user loads local CSV file instead
        { key: 'r2', label: 'รอบ 2 Spot', statsFile: 'r2_spot_item_stats.csv', matrixFile: 'r2_spot_team_item_matrix.csv' },
    ];
    csvRounds.forEach((cr) => {
        const r = cr.source || rds[cr.key];
        if (!r) return;
        const items = r.items || [];
        list.push({ name: cr.statsFile, desc: `${cr.label} — สถิติรายข้อ`, kind: 'csv-stats', icon: 'fa-table',
            items, label: cr.label });
        list.push({ name: cr.matrixFile, desc: `${cr.label} — คะแนนรายข้อ × ทีม/คน`, kind: cr.matrixOk === false ? 'missing' : 'csv-matrix', icon: 'fa-table-list',
            mhead: r.matrixHead, mrows: r.matrixRows, label: cr.label });
        if (cr.final100File) {
            list.push({ name: cr.final100File, desc: `${cr.label} — Final 100 เท่านั้น`, kind: 'csv-matrix', icon: 'fa-table-list',
                mhead: r.matrixHead, mrows: r.final100MatrixRows || r.matrixRows, label: `${cr.label} Final 100` });
        }
    });
    // R3 Gameshow files (lazy-loaded from RTDB /academic_report_r3)
    list.push({ name: 'gameshow_academic_report_2026-11-01.pdf', desc: 'รอบ 3 Gameshow — รายงานฉบับเต็ม (PDF)',
        kind: 'r3-file', icon: 'fa-file-pdf', r3key: 'gameshow_academic_report_2026-11-01_pdf' });
    list.push({ name: 'gameshow_team_answers_2026-11-01.csv', desc: 'รอบ 3 Gameshow — คำตอบรายทีม',
        kind: 'r3-file', icon: 'fa-table', r3key: 'gameshow_team_answers_2026-11-01_csv' });
    fileCatalog = list;
    renderFileButtons();
}

const r3Cache = {};
async function downloadR3(item) {
    const btn = document.querySelector(`.file-btn[data-file="${item.name}"] .file-state`);
    try {
        if (!r3Cache[item.r3key]) {
            if (btn) btn.textContent = 'กำลังโหลด...';
            const { db, ref, get } = await import('./firebase-config.js');
            const snap = await get(ref(db, `academic_report_2026/r3Files/files/${item.r3key}`));
            if (!snap.exists()) throw new Error('ไม่พบไฟล์ใน RTDB');
            r3Cache[item.r3key] = snap.val();
        }
        const f = r3Cache[item.r3key];
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        downloadBlob(item.name, bytes, f.mime);
        if (btn) btn.textContent = '';
    } catch (e) {
        if (btn) btn.textContent = '';
        alert(`โหลด ${item.name} ไม่สำเร็จ: ${e.message}`);
    }
}

function downloadFile(item) {
    if (item.kind === 'r3-file') {
        downloadR3(item);
        return;
    }
    if (item.kind === 'json') {
        const json = JSON.stringify(data, null, 2);
        downloadBlob(item.name, json, 'application/json');
        return;
    }
    if (item.kind === 'html') {
        const html = buildStandaloneHtml();
        downloadBlob(item.name, html, 'text/html');
        return;
    }
    if (item.kind === 'csv-stats') {
        const head = ['รหัสข้อ', 'รูปแบบ', 'คะแนนเต็ม', 'เฉลย', '% ตอบถูก', 'Disc.', 'คะแนนเฉลี่ย', 'N', 'สถานะ', 'โจทย์'];
        const rows = (item.items || []).map((it) => [it.id, it.type, it.pts, it.key, it.diff, it.disc, it.mean, it.n, it.status || '', it.stem || '']);
        downloadBlob(item.name, toCsv(head, rows));
        return;
    }
    if (item.kind === 'csv-matrix') {
        downloadBlob(item.name, toCsv(item.mhead || [], item.mrows || []));
        return;
    }
    // missing — flag for upload
    alert(`ไฟล์ ${item.name} อยู่ในโฟลเดอร์รายงานฉบับเต็ม แต่ยังไม่ได้รวมในชุดข้อมูลเว็บ — ดึงจากโฟลเดอร์ reports/ โดยตรง`);
}

function buildStandaloneHtml() {
    const rds = data.rounds || {};
    const keys = ['r0', 'r1', 'r2', 'r3'].filter((k) => rds[k]);
    const safe = esc;
    let tbl = '';
    keys.forEach((k) => {
        const r = rds[k];
        const s = roundStats(r);
        tbl += `<h2>${safe(r.title)} — ${safe(r.participants)} คน, ${s.count} ข้อ, % ตอบถูกเฉลี่ย ${s.avgDiff}%, Disc. ${s.avgDisc}</h2>`;
        tbl += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:11px;width:100%">';
        tbl += '<tr><th>ข้อ</th><th>รูปแบบ</th><th>เต็ม</th><th>เฉลย</th><th>% ถูก</th><th>Disc.</th><th>เฉลี่ย</th><th>N</th></tr>';
        (r.items || []).forEach((it) => {
            tbl += `<tr><td>${safe(it.id)}</td><td>${safe(it.type)}</td><td>${safe(it.pts)}</td><td>${safe(it.key)}</td><td>${Number(it.diff||0).toFixed(1)}%</td><td>${safe(it.disc)}</td><td>${safe(it.mean)}</td><td>${safe(it.n)}</td></tr>`;
        });
        tbl += '</table><br>';
    });
    return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>MedQuiz KKU 2026 รายงานวิเคราะห์ข้อสอบ</title>
<style>body{font-family:'Sarabun',sans-serif;max-width:1200px;margin:20px auto;padding:0 16px;color:#1e293b}
h1{color:#0f1f4b} h2{font-size:14px;margin-top:24px} table{margin-bottom:12px} th{background:#f1f5f9}
td,th{padding:4px 8px}</style></head><body>
<h1>MedQuiz KKU 2026 — รายงานวิเคราะห์ข้อสอบทุกรอบ (ฝ่ายวิชาการ)</h1>
<p>สร้างเมื่อ: ${safe(data.generatedAt || '-')}</p>${tbl}
</body></html>`;
}

function renderFileButtons() {
    const el = $('downloadFiles');
    if (!el) return;
    if (!fileCatalog.length) { el.innerHTML = '<p class="text-xs text-slate-400">รอโหลดข้อมูลก่อน...</p>'; return; }
    el.innerHTML = fileCatalog.map((f) => {
        const color = f.kind === 'missing' ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' : 'border-slate-200 bg-white hover:bg-slate-50';
        const badge = f.kind === 'missing' ? '<span class="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">ต้องใช้ไฟล์จริง</span>' : '';
        return `<button data-file="${esc(f.name)}" class="border ${color} rounded-lg px-3 py-2.5 text-left text-xs flex items-start gap-2 file-btn">
            <span class="text-slate-400 mt-0.5"><i class="fa-solid ${esc(f.icon)}"></i></span>
            <span class="min-w-0"><span class="block font-semibold">${esc(f.name)}</span><span class="block text-slate-500 text-[11px]">${esc(f.desc)} ${badge} <span class="file-state text-blue-700"></span></span></span>
        </button>`;
    }).join('');
    el.querySelectorAll('.file-btn').forEach((b) => {
        b.addEventListener('click', () => {
            const item = fileCatalog.find((f) => f.name === b.dataset.file);
            if (item) downloadFile(item);
        });
    });
}

function bind() {
    document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));
    ['itemSearch', 'bandFilter', 'teamSearch'].forEach((id) => $(id).addEventListener('input', () => renderRound(activeTab)));
    $('btnPrint').onclick = () => window.print();
    $('fileJson').onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        data = JSON.parse(await f.text());
        fileCatalog = [];
        render();
    };
    $('btnExportStats').onclick = () => {
        const r = (data.rounds || {})[activeTab];
        if (!r) return;
        const head = ['รหัสข้อ', 'รูปแบบ', 'คะแนนเต็ม', 'เฉลย', '% ตอบถูก', 'Disc.', 'คะแนนเฉลี่ย', 'N', 'สถานะ', 'โจทย์'];
        const rows = (r.items || []).map((it) => [it.id, it.type, it.pts, it.key, it.diff, it.disc, it.mean, it.n, it.status || '', it.stem || '']);
        downloadBlob(`${activeTab}_item_stats.csv`, toCsv(head, rows));
    };
    $('btnExportMatrix').onclick = () => {
        const r = (data.rounds || {})[activeTab];
        if (!r) return;
        downloadBlob(`${activeTab}_score_matrix.csv`, toCsv(r.matrixHead || [], r.matrixRows || []));
    };
}

export async function initAcademicReportPage({ fixture }) {
    bind();
    if (fixture) {
        data = buildFixtureReport();
        render();
        return;
    }
    try {
        const { db, ref, get } = await import('./firebase-config.js');
        const snap = await get(ref(db, 'academic_report_2026'));
        if (snap.exists()) {
            data = snap.val();
            fileCatalog = [];
            render();
            return;
        }
    } catch (_) { /* fall back to file upload prompt */ }
    data = buildFixtureReport();
    $('statusLine').textContent = 'ยังไม่ได้ซิงก์ข้อมูลจริงขึ้น RTDB หรือไม่มีสิทธิ์อ่าน — กดปุ่ม "📂 โหลดไฟล์รายงาน (.json)" เพื่อเปิดไฟล์ academic_report_web.json จากเครื่อง';
    renderOverview();
}
