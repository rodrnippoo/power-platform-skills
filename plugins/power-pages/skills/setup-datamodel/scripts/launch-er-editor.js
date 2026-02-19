#!/usr/bin/env node
'use strict';

/**
 * launch-er-editor.js
 *
 * Starts a local HTTP server that serves an interactive ER diagram editor.
 * The editor lets users view, edit, and approve a Dataverse data model before
 * Claude creates the tables.
 *
 * Usage:
 *   node launch-er-editor.js <input-json-file> <output-json-file> [port-file]
 *
 * Exits 0 when the user approves (approved JSON written to <output-json-file>).
 * Exits 2 when the user cancels.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const inputFile = args[0];
const outputFile = args[1] || require('path').join(os.tmpdir(), 'er-approved.json');
const portFile = args[2] || require('path').join(os.tmpdir(), 'er-editor-port.txt');

// ---------------------------------------------------------------------------
// Load & normalise data model
// ---------------------------------------------------------------------------
let dataModel = { publisherPrefix: 'cr', tables: [], relationships: [], mermaidDiagram: '' };

if (inputFile && fs.existsSync(inputFile)) {
  try { dataModel = JSON.parse(fs.readFileSync(inputFile, 'utf8')); }
  catch (e) { console.error('Failed to parse input file:', e.message); }
}

let _idSeq = 1;
const nextId = () => `id_${_idSeq++}`;

function ensureIds(m) {
  m.tables = (m.tables || []).map(t => ({
    ...t, id: t.id || nextId(),
    columns: (t.columns || []).map(c => ({ ...c, id: c.id || nextId() }))
  }));
  m.relationships = (m.relationships || []).map(r => ({ ...r, id: r.id || nextId() }));
  return m;
}
dataModel = ensureIds(dataModel);

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const HTML = buildHTML(dataModel);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/approve' || req.url === '/api/cancel')) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const isApprove = req.url === '/api/approve';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (isApprove) {
        try {
          fs.writeFileSync(outputFile, body, 'utf8');
          res.end(JSON.stringify({ ok: true }));
          console.log(`Approved. Output written to: ${outputFile}`);
          setTimeout(() => { server.close(); process.exit(0); }, 400);
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else {
        res.end(JSON.stringify({ ok: true }));
        console.log('Cancelled.');
        setTimeout(() => { server.close(); process.exit(2); }, 400);
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  fs.writeFileSync(portFile, String(port), 'utf8');
  console.log(`ER Diagram Editor running at http://127.0.0.1:${port}`);
  console.log(`PORT:${port}`);
});

// ---------------------------------------------------------------------------
// HTML generator
// ---------------------------------------------------------------------------
function buildHTML(model) {
  const modelJson = JSON.stringify(model).replace(/<\/script>/gi, '<\\/script>');
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ER Diagram Editor — Power Pages Data Model</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<style>
/* ─── Design tokens ─────────────────────────────────────────── */
:root{
  --c-bg:#ffffff;--c-bg2:#faf9f8;--c-bg3:#f3f2f1;
  --c-border:#edebe9;--c-border2:#d2d0ce;
  --c-text:#201f1e;--c-text2:#605e5c;--c-text3:#a19f9d;
  --c-blue:#0078d4;--c-blue-h:#106ebe;--c-blue-bg:#eff6fc;--c-blue-bg2:#deecf9;
  --c-green:#107c10;--c-green-h:#0b5b0b;--c-green-bg:#dff6dd;
  --c-amber:#d83b01;--c-amber-bg:#fff4ce;
  --c-red:#a4262c;--c-red-h:#751d21;
  --c-new:#107c10;--c-new-bg:#dff6dd;
  --c-mod:#d83b01;--c-mod-bg:#fed9cc;
  --c-reuse:#0078d4;--c-reuse-bg:#deecf9;
  --c-std:#8764b8;--c-std-bg:#f3eef9;
  --shadow:0 1px 4px rgba(0,0,0,.12);
  --shadow2:0 4px 16px rgba(0,0,0,.14);
  --r:4px;--r2:6px;
  --fnt:-apple-system,'Segoe UI',system-ui,sans-serif;
  --fnt-mono:'Cascadia Code','Consolas','Courier New',monospace;
  --h-hdr:52px;--h-ftr:60px;--w-left:272px;--w-right:340px;
  --trans:.14s ease;
}
[data-theme=dark]{
  --c-bg:#1b1a19;--c-bg2:#252423;--c-bg3:#2d2c2b;
  --c-border:#3b3a39;--c-border2:#484644;
  --c-text:#d2d0ce;--c-text2:#a19f9d;--c-text3:#6e6d6b;
  --c-blue:#4fc3f7;--c-blue-h:#81d4fa;--c-blue-bg:#1a3a5c;--c-blue-bg2:#1e3a55;
  --c-green:#6ccb6c;--c-green-h:#8de08d;--c-green-bg:#1a3a1a;
  --c-new:#6ccb6c;--c-new-bg:#1a3a1a;
  --c-mod:#f4a261;--c-mod-bg:#3a2010;
  --c-reuse:#4fc3f7;--c-reuse-bg:#1a2e40;
  --c-std:#c9a0e8;--c-std-bg:#2a1e38;
}

/* ─── Reset ─────────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:var(--fnt);font-size:13px;
  background:var(--c-bg);color:var(--c-text)}
button{font-family:inherit;font-size:inherit;cursor:pointer;border:none;
  background:none;outline:none}
input,select,textarea{font-family:inherit;font-size:inherit}
:focus-visible{outline:2px solid var(--c-blue);outline-offset:1px}

/* ─── Layout ─────────────────────────────────────────────────── */
#app{display:flex;flex-direction:column;height:100vh}
#header{height:var(--h-hdr);min-height:var(--h-hdr);display:flex;align-items:center;
  padding:0 12px;gap:8px;border-bottom:1px solid var(--c-border);
  background:var(--c-bg);box-shadow:var(--shadow);z-index:10;flex-shrink:0}
#main{flex:1;display:flex;overflow:hidden}
#footer{height:var(--h-ftr);min-height:var(--h-ftr);display:flex;align-items:center;
  justify-content:space-between;padding:0 16px;gap:10px;
  border-top:1px solid var(--c-border);background:var(--c-bg2);flex-shrink:0}

/* ─── Panels ─────────────────────────────────────────────────── */
#panel-left{width:var(--w-left);min-width:200px;max-width:420px;
  display:flex;flex-direction:column;border-right:1px solid var(--c-border);
  background:var(--c-bg2);overflow:hidden;resize:horizontal}
#panel-center{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--c-bg3)}
#panel-right{width:var(--w-right);min-width:240px;display:flex;flex-direction:column;
  border-left:1px solid var(--c-border);background:var(--c-bg);overflow:hidden}
.panel-header{padding:10px 12px 8px;font-weight:600;font-size:11px;
  text-transform:uppercase;letter-spacing:.6px;color:var(--c-text2);
  border-bottom:1px solid var(--c-border);display:flex;align-items:center;gap:6px;
  flex-shrink:0}
.panel-body{flex:1;overflow-y:auto;overflow-x:hidden}
.panel-body::-webkit-scrollbar{width:6px}
.panel-body::-webkit-scrollbar-track{background:transparent}
.panel-body::-webkit-scrollbar-thumb{background:var(--c-border2);border-radius:3px}

/* ─── Header elements ────────────────────────────────────────── */
#logo{display:flex;align-items:center;gap:8px;margin-right:8px;flex-shrink:0}
#logo svg{flex-shrink:0}
#logo-title{font-size:14px;font-weight:600;color:var(--c-text);white-space:nowrap}
#logo-sub{font-size:11px;color:var(--c-text3)}
.hdr-sep{width:1px;height:28px;background:var(--c-border);flex-shrink:0}
#stats-row{display:flex;gap:4px;flex-shrink:0}
.stat-chip{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;
  white-space:nowrap;display:flex;align-items:center;gap:3px}
.chip-new{background:var(--c-new-bg);color:var(--c-new)}
.chip-mod{background:var(--c-mod-bg);color:var(--c-mod)}
.chip-reuse{background:var(--c-reuse-bg);color:var(--c-reuse)}
.chip-std{background:var(--c-std-bg);color:var(--c-std)}
#hdr-spacer{flex:1}
.view-tabs{display:flex;border:1px solid var(--c-border);border-radius:var(--r2);
  overflow:hidden;flex-shrink:0}
.view-tab{padding:4px 12px;font-size:12px;font-weight:500;color:var(--c-text2);
  transition:var(--trans);background:transparent;border:none;cursor:pointer}
.view-tab.active{background:var(--c-blue);color:#fff}
.view-tab:not(.active):hover{background:var(--c-bg3)}
.hdr-btn{padding:5px 8px;border-radius:var(--r);font-size:12px;color:var(--c-text2);
  display:flex;align-items:center;gap:4px;transition:var(--trans);border:1px solid transparent}
.hdr-btn:hover{background:var(--c-bg3);border-color:var(--c-border)}
.hdr-btn.active{background:var(--c-blue-bg);color:var(--c-blue);border-color:var(--c-blue)}
.hdr-btn svg{flex-shrink:0}

/* ─── Entity list ────────────────────────────────────────────── */
#search-wrap{padding:8px 8px 6px;flex-shrink:0}
#search-input{width:100%;padding:5px 28px 5px 8px;border:1px solid var(--c-border2);
  border-radius:var(--r);background:var(--c-bg);color:var(--c-text);font-size:12px;
  transition:var(--trans)}
#search-input:focus{border-color:var(--c-blue);box-shadow:0 0 0 2px var(--c-blue-bg)}
#add-table-btn{margin:0 8px 8px;width:calc(100% - 16px);padding:6px;
  border:1px dashed var(--c-border2);border-radius:var(--r);color:var(--c-blue);
  font-size:12px;font-weight:500;background:transparent;
  display:flex;align-items:center;justify-content:center;gap:4px;
  transition:var(--trans);cursor:pointer;flex-shrink:0}
#add-table-btn:hover{background:var(--c-blue-bg);border-color:var(--c-blue)}
.entity-section{margin-bottom:4px}
.section-label{padding:4px 12px;font-size:10px;font-weight:700;text-transform:uppercase;
  letter-spacing:.8px;color:var(--c-text3)}
.table-item{position:relative;border-radius:var(--r);margin:1px 6px;overflow:hidden}
.table-row{display:flex;align-items:center;padding:6px 8px;gap:6px;
  cursor:pointer;border-radius:var(--r);transition:var(--trans);
  border:1px solid transparent}
.table-row:hover{background:var(--c-bg3)}
.table-row.selected{background:var(--c-blue-bg);border-color:var(--c-blue-bg2)}
.table-expand{width:16px;height:16px;display:flex;align-items:center;justify-content:center;
  flex-shrink:0;color:var(--c-text3);transition:transform var(--trans)}
.table-expand.open{transform:rotate(90deg)}
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-new{background:var(--c-new)}
.dot-modified{background:var(--c-mod)}
.dot-reused{background:var(--c-reuse)}
.dot-standard{background:var(--c-std)}
.table-name{flex:1;overflow:hidden}
.table-display{font-size:12px;font-weight:600;color:var(--c-text);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.table-logical{font-size:10px;color:var(--c-text3);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.col-badge{font-size:10px;padding:1px 5px;border-radius:8px;background:var(--c-bg3);
  color:var(--c-text3);flex-shrink:0}
.table-actions{display:none;gap:2px;flex-shrink:0}
.table-row:hover .table-actions,.table-row.selected .table-actions{display:flex}
.tbl-act-btn{width:20px;height:20px;border-radius:var(--r);display:flex;
  align-items:center;justify-content:center;color:var(--c-text3);transition:var(--trans)}
.tbl-act-btn:hover{background:var(--c-border);color:var(--c-text)}
.tbl-act-btn.danger:hover{background:#fde7e9;color:var(--c-red)}
.cols-list{padding-left:32px;padding-bottom:4px}
.col-item{display:flex;align-items:center;gap:5px;padding:3px 6px;border-radius:var(--r);
  cursor:pointer;transition:var(--trans)}
.col-item:hover{background:var(--c-bg3)}
.col-item.selected{background:var(--c-blue-bg)}
.col-type-tag{font-size:9px;padding:1px 4px;border-radius:3px;background:var(--c-bg3);
  color:var(--c-text3);flex-shrink:0;font-family:var(--fnt-mono)}
.col-req-star{color:#c50f1f;font-size:11px;flex-shrink:0}
.col-name-txt{flex:1;font-size:11px;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.add-col-btn{margin:2px 0 2px 32px;padding:3px 8px;font-size:11px;color:var(--c-blue);
  background:transparent;border:none;cursor:pointer;border-radius:var(--r);
  display:flex;align-items:center;gap:3px;transition:var(--trans)}
.add-col-btn:hover{background:var(--c-blue-bg)}
.rels-section{margin-top:8px;border-top:1px solid var(--c-border)}
.rel-item{display:flex;align-items:center;gap:6px;padding:5px 10px;cursor:pointer;
  border-radius:var(--r);margin:1px 6px;transition:var(--trans);border:1px solid transparent}
.rel-item:hover{background:var(--c-bg3)}
.rel-item.selected{background:var(--c-blue-bg);border-color:var(--c-blue-bg2)}
.rel-type-badge{font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700;
  background:var(--c-bg3);color:var(--c-text2);flex-shrink:0;font-family:var(--fnt-mono)}
.rel-desc{flex:1;font-size:11px;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
#add-rel-btn{margin:6px 8px 8px;width:calc(100% - 16px);padding:5px;
  border:1px dashed var(--c-border2);border-radius:var(--r);color:var(--c-text2);
  font-size:11px;background:transparent;display:flex;align-items:center;
  justify-content:center;gap:4px;transition:var(--trans);cursor:pointer;flex-shrink:0}
#add-rel-btn:hover{background:var(--c-bg3);border-color:var(--c-blue);color:var(--c-blue)}

/* ─── Diagram panel ──────────────────────────────────────────── */
#diagram-toolbar{padding:6px 10px;display:flex;align-items:center;gap:6px;
  border-bottom:1px solid var(--c-border);background:var(--c-bg);flex-shrink:0}
.diag-btn{padding:4px 8px;border-radius:var(--r);font-size:12px;color:var(--c-text2);
  display:flex;align-items:center;gap:4px;transition:var(--trans);
  border:1px solid var(--c-border)}
.diag-btn:hover{background:var(--c-bg3);border-color:var(--c-blue);color:var(--c-blue)}
#zoom-display{font-size:11px;color:var(--c-text3);min-width:36px;text-align:center;
  padding:0 4px}
#diag-spacer{flex:1}
.diag-status{font-size:11px;color:var(--c-text3);display:flex;align-items:center;gap:4px}
.spin{animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

#diagram-wrap{flex:1;overflow:auto;display:flex;align-items:flex-start;
  justify-content:center;padding:24px;position:relative}
#diagram-wrap::-webkit-scrollbar{width:8px;height:8px}
#diagram-wrap::-webkit-scrollbar-thumb{background:var(--c-border2);border-radius:4px}
#mermaid-container{transform-origin:top left;transition:transform .2s ease}
#mermaid-container svg{max-width:none!important}
#diagram-error{display:none;position:absolute;top:16px;left:50%;transform:translateX(-50%);
  background:#fde7e9;border:1px solid #f1707b;border-radius:var(--r);padding:8px 12px;
  font-size:12px;color:var(--c-red);max-width:500px;text-align:center}
#code-editor-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px;
  background:var(--c-bg)}
#code-editor{flex:1;width:100%;resize:none;border:1px solid var(--c-border2);
  border-radius:var(--r);padding:10px;font-family:var(--fnt-mono);font-size:12px;
  line-height:1.6;background:var(--c-bg2);color:var(--c-text);
  transition:var(--trans);outline:none}
#code-editor:focus{border-color:var(--c-blue);box-shadow:0 0 0 2px var(--c-blue-bg)}
#code-apply-bar{display:flex;align-items:center;gap:8px;padding:8px 0 0;flex-shrink:0}
.code-err{flex:1;font-size:11px;color:var(--c-red)}
#split-wrap{flex:1;display:flex;overflow:hidden}
#split-diagram{flex:1;overflow:auto;padding:16px;display:flex;align-items:flex-start;
  justify-content:center}
#split-code{width:320px;border-left:1px solid var(--c-border);display:flex;
  flex-direction:column;overflow:hidden;background:var(--c-bg)}
#split-code-editor{flex:1;resize:none;width:100%;border:none;padding:10px;
  font-family:var(--fnt-mono);font-size:11px;line-height:1.6;
  background:var(--c-bg2);color:var(--c-text);outline:none}

/* ─── Properties panel ───────────────────────────────────────── */
#props-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100%;color:var(--c-text3);gap:8px;padding:24px;text-align:center}
#props-empty svg{opacity:.4}
.props-form{padding:12px;display:flex;flex-direction:column;gap:12px}
.field-group{display:flex;flex-direction:column;gap:4px}
.field-label{font-size:11px;font-weight:600;color:var(--c-text2);
  display:flex;align-items:center;justify-content:space-between}
.field-label .req-badge{font-size:10px;font-weight:400;color:var(--c-text3)}
.field-input{padding:6px 8px;border:1px solid var(--c-border2);border-radius:var(--r);
  background:var(--c-bg);color:var(--c-text);font-size:12px;transition:var(--trans);width:100%}
.field-input:focus{border-color:var(--c-blue);box-shadow:0 0 0 2px var(--c-blue-bg);outline:none}
.field-input[readonly]{background:var(--c-bg2);color:var(--c-text3)}
.field-select{padding:6px 8px;border:1px solid var(--c-border2);border-radius:var(--r);
  background:var(--c-bg);color:var(--c-text);font-size:12px;width:100%;cursor:pointer}
.field-select:focus{border-color:var(--c-blue);outline:none}
.field-textarea{padding:6px 8px;border:1px solid var(--c-border2);border-radius:var(--r);
  background:var(--c-bg);color:var(--c-text);font-size:12px;resize:vertical;
  min-height:60px;width:100%;line-height:1.5}
.field-textarea:focus{border-color:var(--c-blue);box-shadow:0 0 0 2px var(--c-blue-bg);outline:none}
.toggle-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.toggle-label{font-size:12px;color:var(--c-text)}
.toggle{position:relative;width:36px;height:20px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.toggle-slider{position:absolute;inset:0;background:var(--c-border2);border-radius:10px;
  cursor:pointer;transition:var(--trans)}
.toggle-slider::before{content:'';position:absolute;width:14px;height:14px;
  border-radius:50%;background:#fff;top:3px;left:3px;transition:var(--trans)}
.toggle input:checked+.toggle-slider{background:var(--c-blue)}
.toggle input:checked+.toggle-slider::before{transform:translateX(16px)}
.status-select-wrap{display:flex;gap:4px}
.status-opt{flex:1;padding:5px 0;border:1px solid var(--c-border);border-radius:var(--r);
  font-size:11px;font-weight:600;text-align:center;cursor:pointer;transition:var(--trans)}
.status-opt[data-status=new].active{background:var(--c-new-bg);color:var(--c-new);
  border-color:var(--c-new)}
.status-opt[data-status=modified].active{background:var(--c-mod-bg);color:var(--c-mod);
  border-color:var(--c-mod)}
.status-opt[data-status=reused].active{background:var(--c-reuse-bg);color:var(--c-reuse);
  border-color:var(--c-reuse)}
.props-section-title{font-size:11px;font-weight:700;text-transform:uppercase;
  letter-spacing:.6px;color:var(--c-text3);padding-top:4px;
  border-top:1px solid var(--c-border);margin-top:4px;padding-top:12px}
.options-list{display:flex;flex-direction:column;gap:4px}
.option-row{display:flex;gap:4px;align-items:center}
.option-input{flex:1;padding:4px 6px;border:1px solid var(--c-border2);border-radius:var(--r);
  background:var(--c-bg);color:var(--c-text);font-size:12px}
.option-del{width:22px;height:22px;border-radius:var(--r);display:flex;align-items:center;
  justify-content:center;color:var(--c-text3);background:transparent;border:none;cursor:pointer}
.option-del:hover{background:#fde7e9;color:var(--c-red)}
.add-option-btn{padding:4px 8px;font-size:11px;color:var(--c-blue);background:transparent;
  border:1px dashed var(--c-border);border-radius:var(--r);cursor:pointer;width:100%;
  display:flex;align-items:center;justify-content:center;gap:4px;transition:var(--trans)}
.add-option-btn:hover{background:var(--c-blue-bg);border-color:var(--c-blue)}
.props-del-btn{margin-top:8px;padding:7px;width:100%;border-radius:var(--r);
  border:1px solid #f1707b;color:var(--c-red);background:transparent;font-size:12px;
  font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;
  gap:6px;transition:var(--trans)}
.props-del-btn:hover{background:#fde7e9}
.props-hdr{padding:12px 12px 8px;border-bottom:1px solid var(--c-border);display:flex;
  align-items:center;gap:8px;flex-shrink:0}
.props-hdr-icon{width:28px;height:28px;border-radius:var(--r);display:flex;
  align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.props-hdr-name{font-size:13px;font-weight:600;color:var(--c-text);flex:1;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.props-status-badge{font-size:10px;font-weight:600;padding:2px 6px;border-radius:8px}

/* ─── Footer ─────────────────────────────────────────────────── */
#footer-stats{font-size:12px;color:var(--c-text2)}
#footer-actions{display:flex;gap:8px}
.btn{padding:8px 16px;border-radius:var(--r2);font-size:13px;font-weight:500;
  cursor:pointer;display:flex;align-items:center;gap:6px;transition:var(--trans);
  border:1px solid transparent}
.btn-primary{background:var(--c-green);color:#fff;border-color:var(--c-green)}
.btn-primary:hover{background:var(--c-green-h);border-color:var(--c-green-h)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-secondary{background:transparent;color:var(--c-text);border-color:var(--c-border2)}
.btn-secondary:hover{background:var(--c-bg3);border-color:var(--c-blue);color:var(--c-blue)}
.btn-danger{background:transparent;color:var(--c-red);border-color:var(--c-border2)}
.btn-danger:hover{background:#fde7e9;border-color:var(--c-red)}
#footer-warnings{display:flex;gap:6px;align-items:center}
.warn-chip{font-size:11px;padding:2px 8px;border-radius:8px;background:var(--c-amber-bg);
  color:var(--c-amber);font-weight:600;display:flex;align-items:center;gap:3px}

/* ─── Validation tooltip ─────────────────────────────────────── */
.validation-msg{font-size:11px;color:var(--c-red);display:flex;align-items:center;gap:4px;
  padding:3px 0}

/* ─── Modal ──────────────────────────────────────────────────── */
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);
  display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:var(--c-bg);border-radius:var(--r2);box-shadow:var(--shadow2);
  padding:0;min-width:400px;max-width:520px;width:100%;overflow:hidden}
.modal-hdr{padding:16px 20px;border-bottom:1px solid var(--c-border);display:flex;
  align-items:center;justify-content:space-between}
.modal-title{font-size:14px;font-weight:600}
.modal-close{width:28px;height:28px;border-radius:var(--r);display:flex;align-items:center;
  justify-content:center;color:var(--c-text2);background:transparent;border:none;cursor:pointer}
.modal-close:hover{background:var(--c-bg3);color:var(--c-text)}
.modal-body{padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.modal-ftr{padding:12px 20px;border-top:1px solid var(--c-border);display:flex;
  justify-content:flex-end;gap:8px}

/* ─── Notify toast ───────────────────────────────────────────── */
#toast-container{position:fixed;bottom:80px;right:16px;display:flex;flex-direction:column;
  gap:6px;z-index:200;pointer-events:none}
.toast{padding:8px 14px;border-radius:var(--r2);font-size:12px;font-weight:500;
  box-shadow:var(--shadow2);animation:slideIn .2s ease;pointer-events:auto}
.toast-success{background:var(--c-green-bg);color:var(--c-green);border:1px solid var(--c-green)}
.toast-error{background:#fde7e9;color:var(--c-red);border:1px solid var(--c-red)}
.toast-info{background:var(--c-blue-bg);color:var(--c-blue);border:1px solid var(--c-blue)}
@keyframes slideIn{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
</style>
</head>
<body>
<div id="app">
  <!-- HEADER -->
  <header id="header">
    <div id="logo">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="4" fill="#0078d4"/>
        <path d="M5 8h14M5 12h9M5 16h11" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <div>
        <div id="logo-title">ER Diagram Editor</div>
        <div id="logo-sub">Power Pages Data Model</div>
      </div>
    </div>
    <div class="hdr-sep"></div>
    <div id="stats-row"></div>
    <div id="hdr-spacer"></div>
    <div class="view-tabs">
      <button class="view-tab active" data-view="visual">Visual</button>
      <button class="view-tab" data-view="code">Code</button>
      <button class="view-tab" data-view="split">Split</button>
    </div>
    <div class="hdr-sep"></div>
    <button class="hdr-btn" id="undo-btn" title="Undo (Ctrl+Z)" disabled>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M3.5 6H10a4 4 0 0 1 0 8H6v-1.5h4a2.5 2.5 0 0 0 0-5H3.5l2 2-1 1L1 8l3.5-3.5 1 1-2 2z"/>
      </svg>
    </button>
    <button class="hdr-btn" id="redo-btn" title="Redo (Ctrl+Y)" disabled>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.5 6H6a4 4 0 0 0 0 8h4v-1.5H6a2.5 2.5 0 0 1 0-5h6.5l-2 2 1 1L15 8l-3.5-3.5-1 1 2 2z"/>
      </svg>
    </button>
    <div class="hdr-sep"></div>
    <button class="hdr-btn" id="theme-btn" title="Toggle dark mode">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" id="theme-icon">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5A5.5 5.5 0 1 1 8 13.5V2.5z"/>
      </svg>
    </button>
  </header>

  <!-- MAIN -->
  <div id="main">
    <!-- LEFT: Entity Explorer -->
    <aside id="panel-left">
      <div class="panel-header">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/>
        </svg>
        Entities
      </div>
      <div id="search-wrap">
        <input id="search-input" type="text" placeholder="Search tables…" autocomplete="off">
      </div>
      <button id="add-table-btn">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Add Table
      </button>
      <div class="panel-body" id="entity-list"></div>
      <div class="rels-section">
        <div class="panel-header" style="border-top:none">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 4a3 3 0 0 1 6 0v1h2V4a3 3 0 0 1 6 0v1h-1v7h1v1h-5v-1h1V5h-2v7h1v1H1v-1h1V5H1V4zm1 1v7h3V5H2zm9 0v7h3V5h-3z"/>
          </svg>
          Relationships
        </div>
        <div id="rel-list"></div>
        <button id="add-rel-btn">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          Add Relationship
        </button>
      </div>
    </aside>

    <!-- CENTER: Diagram / Code -->
    <main id="panel-center">
      <!-- Visual view -->
      <div id="visual-view">
        <div id="diagram-toolbar">
          <button class="diag-btn" id="zoom-out-btn" title="Zoom Out">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M2 7h12v2H2z"/></svg>
          </button>
          <span id="zoom-display">100%</span>
          <button class="diag-btn" id="zoom-in-btn" title="Zoom In">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <button class="diag-btn" id="zoom-fit-btn" title="Fit to View">Fit</button>
          <button class="diag-btn" id="zoom-reset-btn" title="100%">1:1</button>
          <div id="diag-spacer"></div>
          <div class="diag-status" id="diag-status">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="color:var(--c-green)">
              <path d="M7 1a6 6 0 1 0 0 12A6 6 0 0 0 7 1zm2.9 3.9-3.4 3.4-1.4-1.5L4 8l1.5 1.5L9.9 5l-1-1z"/>
            </svg>
            Ready
          </div>
          <button class="diag-btn" id="copy-mermaid-btn" title="Copy Mermaid code">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 4h5l3 3v6H4V4zM9 4v3h3M2 2h7l3 3v6"/>
            </svg>
            Copy Mermaid
          </button>
        </div>
        <div id="diagram-wrap">
          <div id="mermaid-container"></div>
          <div id="diagram-error"></div>
        </div>
      </div>

      <!-- Code view -->
      <div id="code-view" style="display:none;flex:1;flex-direction:column">
        <div id="code-editor-wrap">
          <textarea id="code-editor" spellcheck="false" placeholder="erDiagram&#10;    ..."></textarea>
          <div id="code-apply-bar">
            <button class="btn btn-secondary" id="code-apply-btn" style="padding:5px 12px;font-size:12px">Apply Changes</button>
            <button class="btn btn-secondary" id="code-reset-btn" style="padding:5px 12px;font-size:12px">Reset</button>
            <span class="code-err" id="code-err-msg"></span>
          </div>
        </div>
      </div>

      <!-- Split view -->
      <div id="split-view" style="display:none;flex:1">
        <div id="split-wrap">
          <div id="split-diagram"><div id="split-mermaid"></div></div>
          <div id="split-code">
            <div class="panel-header">Mermaid Code</div>
            <textarea id="split-code-editor" spellcheck="false"></textarea>
          </div>
        </div>
      </div>
    </main>

    <!-- RIGHT: Properties -->
    <aside id="panel-right">
      <div class="panel-header">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 4h14v2H1zm0 4h8v2H1zm0 4h11v2H1z"/>
        </svg>
        Properties
      </div>
      <div class="panel-body" id="props-panel">
        <div id="props-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4h7v7H4zm0 9h7v7H4zm9-9h7v7h-7zm2 2v3h3V6h-3zm-2 9h7v7h-7zm2 2v3h3v-3h-3z"/>
          </svg>
          <div style="font-size:12px">Select a table, column, or relationship to edit properties</div>
        </div>
      </div>
    </aside>
  </div>

  <!-- FOOTER -->
  <footer id="footer">
    <div id="footer-stats"></div>
    <div id="footer-warnings"></div>
    <div id="footer-actions">
      <button class="btn btn-danger" id="cancel-btn">Cancel</button>
      <button class="btn btn-secondary" id="export-btn">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1v9M4 6l4 4 4-4M1 11v3h14v-3"/>
        </svg>
        Export JSON
      </button>
      <button class="btn btn-primary" id="approve-btn">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
        </svg>
        Approve &amp; Create Tables
      </button>
    </div>
  </footer>
</div>

<!-- Toast container -->
<div id="toast-container"></div>

<!-- Modals injected dynamically -->

<script>
/* ──────────────────────────────────────────────────────────────
   INITIAL STATE (injected by server)
────────────────────────────────────────────────────────────── */
const INITIAL_MODEL = ${modelJson};

const COLUMN_TYPES = [
  {v:'SingleLine.Text',    l:'Single Line Text',   tag:'TXT'},
  {v:'MultiLine.Text',     l:'Multi Line Text',    tag:'MEMO'},
  {v:'WholeNumber',        l:'Whole Number',        tag:'INT'},
  {v:'Decimal',            l:'Decimal',             tag:'DEC'},
  {v:'Currency',           l:'Currency',            tag:'$'},
  {v:'DateTime',           l:'Date & Time',         tag:'DATE'},
  {v:'Boolean',            l:'Yes / No',            tag:'BOOL'},
  {v:'Choice',             l:'Choice',              tag:'PICK'},
  {v:'MultiSelectPicklist',l:'Multi-Select Choice', tag:'MPCK'},
  {v:'Lookup',             l:'Lookup',              tag:'LKP'},
  {v:'Customer',           l:'Customer',            tag:'CUST'},
  {v:'Owner',              l:'Owner',               tag:'OWN'},
  {v:'Image',              l:'Image',               tag:'IMG'},
  {v:'File',               l:'File',                tag:'FILE'},
  {v:'UniqueIdentifier',   l:'Unique Identifier',   tag:'GUID'},
];

const STATUS_CONFIG = {
  new:      {label:'New',      dotClass:'dot-new',      badgeStyle:'background:var(--c-new-bg);color:var(--c-new)'},
  modified: {label:'Modified', dotClass:'dot-modified',  badgeStyle:'background:var(--c-mod-bg);color:var(--c-mod)'},
  reused:   {label:'Reused',   dotClass:'dot-reused',    badgeStyle:'background:var(--c-reuse-bg);color:var(--c-reuse)'},
  standard: {label:'Standard', dotClass:'dot-standard',  badgeStyle:'background:var(--c-std-bg);color:var(--c-std)'},
};

/* ──────────────────────────────────────────────────────────────
   STATE
────────────────────────────────────────────────────────────── */
let model = deepClone(INITIAL_MODEL);
let history = [];
let future  = [];
let selId = null, selType = null, selParentId = null;
let viewMode = 'visual';
let searchQ  = '';
let zoom     = 1;
let renderTimer = null;
let isDirty  = false;

/* ──────────────────────────────────────────────────────────────
   UTILITY
────────────────────────────────────────────────────────────── */
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function uid() { return 'id_' + Math.random().toString(36).slice(2, 10); }

function slugify(s, prefix) {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) return '';
  if (prefix && !slug.startsWith(prefix + '_')) return prefix + '_' + slug;
  return slug;
}

function pushHistory() {
  history.push(deepClone(model));
  if (history.length > 50) history.shift();
  future = [];
  isDirty = true;
  updateUndoRedo();
}

function updateUndoRedo() {
  document.getElementById('undo-btn').disabled = history.length === 0;
  document.getElementById('redo-btn').disabled = future.length === 0;
}

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = \`toast toast-\${type}\`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ──────────────────────────────────────────────────────────────
   MERMAID GENERATION
────────────────────────────────────────────────────────────── */
function buildMermaid(m) {
  const lines = ['erDiagram'];
  for (const t of m.tables) {
    const node = t.logicalName.toUpperCase();
    lines.push(\`    \${node}["\${esc(t.logicalName)} (\${esc(t.displayName)})"]\${statusAnnotation(t.status)} {\`);
    for (const c of (t.columns||[])) {
      const typeShort = (c.type||'String').split('.').pop();
      const req = c.required ? ' "Required"' : '';
      lines.push(\`        \${typeShort} \${c.logicalName||'unnamed'}\${req}\`);
    }
    lines.push('    }');
  }
  for (const r of (m.relationships||[])) {
    const from = r.referencedTable || r.fromTable || '';
    const to   = r.referencingTable || r.toTable || '';
    if (!from || !to) continue;
    const card = r.type === 'M:N' ? '}o--o{' : '||--o{';
    const lbl  = r.label || 'has';
    lines.push(\`    \${from.toUpperCase()} \${card} \${to.toUpperCase()} : "\${esc(lbl)}"\`);
  }
  return lines.join('\\n');
}

function statusAnnotation(s) {
  const m = {new:':::new', modified:':::modified', reused:':::reused'};
  return m[s] || '';
}

/* ──────────────────────────────────────────────────────────────
   DIAGRAM RENDERING
────────────────────────────────────────────────────────────── */
mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
  er: { fontSize: 13, useMaxWidth: false }, securityLevel: 'loose' });

let renderId = 0;
async function renderDiagram(target, code) {
  const errEl = document.getElementById('diagram-error');
  const statusEl = document.getElementById('diag-status');
  if (statusEl) statusEl.innerHTML = \`<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" class="spin" style="color:var(--c-text3)"><path d="M8 2a6 6 0 1 0 6 6"/></svg> Rendering…\`;
  try {
    const id = ++renderId;
    const mermaidCode = code || buildMermaid(model);
    const { svg } = await mermaid.render(\`mermaid-\${id}\`, mermaidCode);
    if (id !== renderId) return; // stale
    target.innerHTML = svg;
    target.querySelectorAll('svg').forEach(s => {
      s.style.maxWidth = 'none';
      s.style.height = 'auto';
    });
    if (errEl) errEl.style.display = 'none';
    if (statusEl) statusEl.innerHTML = \`<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="color:var(--c-green)"><path d="M7 1a6 6 0 1 0 0 12A6 6 0 0 0 7 1zm2.9 3.9-3.4 3.4-1.4-1.5L4 8l1.5 1.5L9.9 5l-1-1z"/></svg> Ready\`;
  } catch (e) {
    if (errEl) { errEl.textContent = 'Diagram error: ' + e.message; errEl.style.display = 'block'; }
    if (statusEl) statusEl.innerHTML = \`<svg width="12" height="12" fill="currentColor" style="color:var(--c-red)" viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.5h1.5v5h-1.5zm0 6h1.5v1.5h-1.5z"/></svg> Error\`;
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const code = buildMermaid(model);
    if (viewMode === 'visual') {
      await renderDiagram(document.getElementById('mermaid-container'), code);
    } else if (viewMode === 'split') {
      await renderDiagram(document.getElementById('split-mermaid'), code);
      document.getElementById('split-code-editor').value = code;
    }
    document.getElementById('code-editor').value = code;
  }, 400);
}

/* ──────────────────────────────────────────────────────────────
   VALIDATION
────────────────────────────────────────────────────────────── */
function validate(m) {
  const errors = [];
  const logicalNames = new Set();
  for (const t of m.tables) {
    if (!t.logicalName) errors.push(\`Table "\${t.displayName}" has no logical name\`);
    if (logicalNames.has(t.logicalName)) errors.push(\`Duplicate logical name: \${t.logicalName}\`);
    logicalNames.add(t.logicalName);
    for (const c of (t.columns||[])) {
      if (!c.logicalName) errors.push(\`Column "\${c.displayName}" in \${t.logicalName} has no logical name\`);
    }
  }
  for (const r of (m.relationships||[])) {
    const from = r.referencedTable || r.fromTable;
    const to   = r.referencingTable || r.toTable;
    const tables = m.tables.map(t => t.logicalName);
    if (from && !tables.includes(from)) errors.push(\`Relationship references unknown table: \${from}\`);
    if (to && !tables.includes(to)) errors.push(\`Relationship references unknown table: \${to}\`);
  }
  return errors;
}

/* ──────────────────────────────────────────────────────────────
   STATS
────────────────────────────────────────────────────────────── */
function updateStats() {
  const counts = {new:0, modified:0, reused:0, standard:0};
  for (const t of model.tables) counts[t.status] = (counts[t.status]||0) + 1;
  const colCount = model.tables.reduce((s,t) => s + (t.columns||[]).length, 0);
  const relCount = (model.relationships||[]).length;

  const chips = document.getElementById('stats-row');
  chips.innerHTML = '';
  if (counts.new)      chips.innerHTML += \`<span class="stat-chip chip-new">\${counts.new} New</span>\`;
  if (counts.modified) chips.innerHTML += \`<span class="stat-chip chip-mod">\${counts.modified} Modified</span>\`;
  if (counts.reused)   chips.innerHTML += \`<span class="stat-chip chip-reuse">\${counts.reused} Reused</span>\`;

  document.getElementById('footer-stats').textContent =
    \`\${model.tables.length} table\${model.tables.length!==1?'s':''} · \${colCount} columns · \${relCount} relationships\`;

  const errs = validate(model);
  const warnEl = document.getElementById('footer-warnings');
  warnEl.innerHTML = errs.length ? \`<span class="warn-chip">⚠ \${errs.length} validation issue\${errs.length>1?'s':''}</span>\` : '';
  document.getElementById('approve-btn').disabled = errs.length > 0;
}

/* ──────────────────────────────────────────────────────────────
   ENTITY LIST RENDERING
────────────────────────────────────────────────────────────── */
const expandedTables = new Set();

function renderEntityList() {
  const list = document.getElementById('entity-list');
  const q = searchQ.toLowerCase();
  const filtered = model.tables.filter(t =>
    !q || t.displayName.toLowerCase().includes(q) ||
    t.logicalName.toLowerCase().includes(q) ||
    (t.columns||[]).some(c => c.displayName.toLowerCase().includes(q) || c.logicalName.toLowerCase().includes(q))
  );

  list.innerHTML = filtered.length === 0
    ? \`<div style="padding:12px;color:var(--c-text3);font-size:12px;text-align:center">No tables found</div>\`
    : filtered.map(t => renderTableItem(t)).join('');

  // Relationship list
  const relList = document.getElementById('rel-list');
  relList.innerHTML = (model.relationships||[]).map(r => renderRelItem(r)).join('');

  attachListEvents();
}

function renderTableItem(t) {
  const sc   = STATUS_CONFIG[t.status] || STATUS_CONFIG.new;
  const isExp = expandedTables.has(t.id);
  const isSel = selType === 'table' && selId === t.id;
  const colCount = (t.columns||[]).length;
  const cols = isExp ? (t.columns||[]).map(c => renderColItem(t, c)).join('') : '';
  const addColBtn = isExp
    ? \`<button class="add-col-btn" data-tid="\${t.id}">+ Add Column</button>\` : '';

  return \`
<div class="table-item" data-tid="\${t.id}">
  <div class="table-row\${isSel?' selected':''}" data-action="select-table" data-tid="\${t.id}">
    <span class="table-expand\${isExp?' open':''}" data-action="toggle-table" data-tid="\${t.id}">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><path d="M2 1l5 3.5L2 8V1z"/></svg>
    </span>
    <span class="status-dot \${sc.dotClass}"></span>
    <span class="table-name">
      <div class="table-display">\${esc(t.displayName||'Untitled')}</div>
      <div class="table-logical">\${esc(t.logicalName||'')}</div>
    </span>
    <span class="col-badge">\${colCount}</span>
    <span class="table-actions">
      <button class="tbl-act-btn" title="Add Column" data-action="add-col" data-tid="\${t.id}">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button class="tbl-act-btn danger" title="Delete Table" data-action="delete-table" data-tid="\${t.id}">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </span>
  </div>
  \${isExp ? \`<div class="cols-list">\${cols}\${addColBtn}</div>\` : ''}
</div>\`;
}

function renderColItem(t, c) {
  const isSel = selType === 'column' && selId === c.id;
  const typeInfo = COLUMN_TYPES.find(x => x.v === c.type) || {tag: '?'};
  return \`
<div class="col-item\${isSel?' selected':''}" data-action="select-col" data-cid="\${c.id}" data-tid="\${t.id}">
  \${c.required ? '<span class="col-req-star" title="Required">*</span>' : '<span style="width:11px;display:inline-block"></span>'}
  <span class="col-name-txt">\${esc(c.displayName||c.logicalName||'Unnamed')}</span>
  <span class="col-type-tag">\${typeInfo.tag}</span>
</div>\`;
}

function renderRelItem(r) {
  const isSel = selType === 'relationship' && selId === r.id;
  const from  = r.referencedTable || r.fromTable || '?';
  const to    = r.referencingTable || r.toTable   || '?';
  return \`
<div class="rel-item\${isSel?' selected':''}" data-action="select-rel" data-rid="\${r.id}">
  <span class="rel-type-badge">\${esc(r.type||'1:N')}</span>
  <span class="rel-desc">\${esc(from)} → \${esc(to)}\${r.label ? ' "'+esc(r.label)+'"' : ''}</span>
  <button class="tbl-act-btn danger" title="Delete" data-action="delete-rel" data-rid="\${r.id}" style="display:flex">
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
  </button>
</div>\`;
}

function attachListEvents() {
  document.getElementById('entity-list').querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const action = el.dataset.action;
      if (action === 'select-table')  { selectItem(el.dataset.tid, 'table'); }
      if (action === 'toggle-table')  { toggleTable(el.dataset.tid); }
      if (action === 'add-col')       { addColumn(el.dataset.tid); }
      if (action === 'delete-table')  { confirmDeleteTable(el.dataset.tid); }
      if (action === 'select-col')    { selectItem(el.dataset.cid, 'column', el.dataset.tid); }
    });
  });
  document.getElementById('rel-list').querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (el.dataset.action === 'select-rel')  selectItem(el.dataset.rid, 'relationship');
      if (el.dataset.action === 'delete-rel')  deleteRelationship(el.dataset.rid);
    });
  });
  document.getElementById('rel-list').querySelectorAll('.rel-item').forEach(el => {
    el.addEventListener('click', () => selectItem(el.dataset.rid, 'relationship'));
  });
}

function toggleTable(id) {
  if (expandedTables.has(id)) expandedTables.delete(id);
  else expandedTables.add(id);
  renderEntityList();
}

/* ──────────────────────────────────────────────────────────────
   SELECTION & PROPERTIES
────────────────────────────────────────────────────────────── */
function selectItem(id, type, parentId) {
  selId = id; selType = type; selParentId = parentId || null;
  renderEntityList();
  renderProperties();
}

function renderProperties() {
  const panel = document.getElementById('props-panel');
  if (!selId) { panel.innerHTML = document.getElementById('props-empty').outerHTML; return; }

  if (selType === 'table') {
    const t = model.tables.find(x => x.id === selId);
    if (!t) return;
    panel.innerHTML = buildTableProps(t);
    bindTablePropEvents(t);
  } else if (selType === 'column') {
    const tbl = model.tables.find(x => x.id === selParentId);
    const col = tbl && tbl.columns.find(c => c.id === selId);
    if (!tbl || !col) return;
    panel.innerHTML = buildColumnProps(tbl, col);
    bindColPropEvents(tbl, col);
  } else if (selType === 'relationship') {
    const r = (model.relationships||[]).find(x => x.id === selId);
    if (!r) return;
    panel.innerHTML = buildRelProps(r);
    bindRelPropEvents(r);
  }
}

function buildTableProps(t) {
  const sc = STATUS_CONFIG[t.status] || STATUS_CONFIG.new;
  const tableOptions = model.tables.map(tbl =>
    \`<option value="\${esc(tbl.logicalName)}" \${tbl.id===t.id?'selected':''}>\${esc(tbl.displayName)} (\${esc(tbl.logicalName)})</option>\`
  ).join('');

  return \`
<div class="props-hdr">
  <div class="props-hdr-icon" style="\${sc.badgeStyle};font-size:16px">⊞</div>
  <div class="props-hdr-name">\${esc(t.displayName||'Untitled Table')}</div>
  <span class="props-status-badge" style="\${sc.badgeStyle}">\${sc.label}</span>
</div>
<div class="panel-body">
<div class="props-form" id="table-form">
  <div class="field-group">
    <label class="field-label">Display Name <span class="req-badge">Required</span></label>
    <input class="field-input" id="prop-display" value="\${esc(t.displayName||'')}" placeholder="e.g. Project">
  </div>
  <div class="field-group">
    <label class="field-label">Logical Name <span class="req-badge">auto-generated</span></label>
    <input class="field-input" id="prop-logical" value="\${esc(t.logicalName||'')}" placeholder="e.g. cr123_project">
    <div id="logical-validation" class="validation-msg" style="display:none"></div>
  </div>
  <div class="field-group">
    <label class="field-label">Description</label>
    <textarea class="field-textarea" id="prop-desc" rows="2">\${esc(t.description||'')}</textarea>
  </div>
  <div class="field-group">
    <label class="field-label">Status</label>
    <div class="status-select-wrap">
      \${['new','modified','reused'].map(s => {
        const c = STATUS_CONFIG[s];
        return \`<div class="status-opt\${t.status===s?' active':''}" data-status="\${s}" style="\${t.status===s?c.badgeStyle:''}">\${c.label}</div>\`;
      }).join('')}
    </div>
  </div>
  <div class="props-section-title">Columns (\${(t.columns||[]).length})</div>
  \${(t.columns||[]).map(c => \`
  <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--c-border)">
    <span style="flex:1;font-size:12px;color:var(--c-text)">\${esc(c.displayName||c.logicalName)}</span>
    <span class="col-type-tag">\${(COLUMN_TYPES.find(x=>x.v===c.type)||{tag:'?'}).tag}</span>
    \${c.required?'<span class="col-req-star">*</span>':''}
    <button class="tbl-act-btn" style="display:flex" title="Edit" data-action="edit-col" data-cid="\${c.id}">
      <svg width="10" height="10" fill="currentColor" viewBox="0 0 12 12"><path d="M1 9.5V11h1.5l5.2-5.2-1.5-1.5L1 9.5zm7-7a.84.84 0 0 0-1.2 0L5.6 3.7l1.5 1.5L8.3 4a.84.84 0 0 0 0-1.5z"/></svg>
    </button>
  </div>\`).join('')}
  <button class="add-option-btn" id="prop-add-col-btn" style="margin-top:6px">+ Add Column</button>
  <button class="props-del-btn" id="prop-del-table-btn">
    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M2 5h12l-1 9H3L2 5zm4-3h4v2H6V2zM1 3h14v2H1V3z"/></svg>
    Delete Table
  </button>
</div>
</div>\`;
}

function bindTablePropEvents(t) {
  const displayIn  = document.getElementById('prop-display');
  const logicalIn  = document.getElementById('prop-logical');
  const descIn     = document.getElementById('prop-desc');
  const logValMsg  = document.getElementById('logical-validation');

  // Auto-generate logical name from display
  displayIn.addEventListener('input', () => {
    const prefix = model.publisherPrefix || 'cr';
    const auto = slugify(displayIn.value, prefix);
    if (!logicalIn.dataset.manuallyEdited) logicalIn.value = auto;
    scheduleUpdate();
  });
  logicalIn.addEventListener('input', () => {
    logicalIn.dataset.manuallyEdited = '1';
    scheduleUpdate();
  });
  descIn.addEventListener('input', scheduleUpdate);

  document.querySelectorAll('.status-opt').forEach(el => {
    el.addEventListener('click', () => {
      pushHistory();
      t.status = el.dataset.status;
      refreshAll();
    });
  });

  function scheduleUpdate() {
    clearTimeout(logicalIn._timer);
    logicalIn._timer = setTimeout(() => {
      const newLogical = logicalIn.value.trim();
      const dup = model.tables.some(tbl => tbl.id !== t.id && tbl.logicalName === newLogical);
      if (dup) {
        logValMsg.textContent = '⚠ Duplicate logical name';
        logValMsg.style.display = 'flex';
      } else {
        logValMsg.style.display = 'none';
      }
      pushHistory();
      t.displayName  = displayIn.value;
      t.logicalName  = newLogical;
      t.description  = descIn.value;
      updateStats(); renderEntityList(); scheduleRender();
    }, 500);
  }

  document.getElementById('prop-add-col-btn').addEventListener('click', () => addColumn(t.id));
  document.getElementById('prop-del-table-btn').addEventListener('click', () => confirmDeleteTable(t.id));

  document.querySelectorAll('[data-action="edit-col"]').forEach(btn => {
    btn.addEventListener('click', () => selectItem(btn.dataset.cid, 'column', t.id));
  });
}

function buildColumnProps(tbl, col) {
  const hasOptions = col.type === 'Choice' || col.type === 'MultiSelectPicklist';
  const typeOptions = COLUMN_TYPES.map(tp =>
    \`<option value="\${tp.v}" \${col.type===tp.v?'selected':''}>\${tp.l}</option>\`
  ).join('');

  const optionsHtml = hasOptions ? \`
  <div class="field-group">
    <label class="field-label">Choice Options</label>
    <div class="options-list" id="choice-options">
      \${(col.options||[]).map((o,i) => \`
      <div class="option-row">
        <input class="option-input" data-oi="\${i}" value="\${esc(o)}" placeholder="Option \${i+1}">
        <button class="option-del" data-oi="\${i}" title="Remove">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>\`).join('')}
    </div>
    <button class="add-option-btn" id="add-choice-opt">+ Add Option</button>
  </div>\` : '';

  return \`
<div class="props-hdr" style="border-bottom:1px solid var(--c-border)">
  <div class="props-hdr-icon" style="background:var(--c-bg3);font-size:16px">≡</div>
  <div style="flex:1;overflow:hidden">
    <div class="props-hdr-name">\${esc(col.displayName||col.logicalName||'Column')}</div>
    <div style="font-size:11px;color:var(--c-text3)">\${esc(tbl.displayName)}</div>
  </div>
</div>
<div class="panel-body">
<div class="props-form">
  <div class="field-group">
    <label class="field-label">Display Name</label>
    <input class="field-input" id="col-display" value="\${esc(col.displayName||'')}">
  </div>
  <div class="field-group">
    <label class="field-label">Logical Name</label>
    <input class="field-input" id="col-logical" value="\${esc(col.logicalName||'')}">
  </div>
  <div class="field-group">
    <label class="field-label">Type</label>
    <select class="field-select" id="col-type">\${typeOptions}</select>
  </div>
  \${col.type === 'SingleLine.Text' ? \`
  <div class="field-group">
    <label class="field-label">Max Length</label>
    <input class="field-input" id="col-maxlen" type="number" min="1" max="4000" value="\${col.maxLength||100}">
  </div>\` : ''}
  <div class="field-group">
    <label class="field-label">Description</label>
    <textarea class="field-textarea" id="col-desc" rows="2">\${esc(col.description||'')}</textarea>
  </div>
  <div class="toggle-row">
    <span class="toggle-label">Required</span>
    <label class="toggle"><input type="checkbox" id="col-required" \${col.required?'checked':''}><span class="toggle-slider"></span></label>
  </div>
  \${optionsHtml}
  <button class="props-del-btn" id="col-del-btn">
    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M2 5h12l-1 9H3L2 5zm4-3h4v2H6V2zM1 3h14v2H1V3z"/></svg>
    Delete Column
  </button>
</div>
</div>\`;
}

function bindColPropEvents(tbl, col) {
  function saveCol() {
    pushHistory();
    const prefix = model.publisherPrefix || 'cr';
    col.displayName = document.getElementById('col-display').value;
    col.logicalName = document.getElementById('col-logical').value || slugify(col.displayName, prefix);
    col.type        = document.getElementById('col-type').value;
    col.required    = document.getElementById('col-required').checked;
    const descEl    = document.getElementById('col-desc');
    if (descEl) col.description = descEl.value;
    const maxEl     = document.getElementById('col-maxlen');
    if (maxEl) col.maxLength = parseInt(maxEl.value) || 100;
    refreshAll();
  }

  ['col-display','col-logical','col-type','col-required','col-desc','col-maxlen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveCol);
  });
  document.getElementById('col-display').addEventListener('input', () => {
    const logEl = document.getElementById('col-logical');
    if (!logEl.dataset.manuallyEdited) {
      logEl.value = slugify(document.getElementById('col-display').value, model.publisherPrefix||'cr');
    }
  });
  document.getElementById('col-logical').addEventListener('input', () => {
    document.getElementById('col-logical').dataset.manuallyEdited = '1';
  });
  document.getElementById('col-type').addEventListener('change', () => {
    saveCol();
    selectItem(col.id, 'column', tbl.id); // re-render to show/hide options
  });

  const addOptBtn = document.getElementById('add-choice-opt');
  if (addOptBtn) {
    addOptBtn.addEventListener('click', () => {
      pushHistory();
      col.options = col.options || [];
      col.options.push('Option ' + (col.options.length + 1));
      selectItem(col.id, 'column', tbl.id);
    });
  }
  document.querySelectorAll('.option-del').forEach(btn => {
    btn.addEventListener('click', () => {
      pushHistory();
      col.options.splice(parseInt(btn.dataset.oi), 1);
      selectItem(col.id, 'column', tbl.id);
    });
  });
  document.querySelectorAll('.option-input').forEach(inp => {
    inp.addEventListener('change', () => {
      pushHistory();
      col.options[parseInt(inp.dataset.oi)] = inp.value;
    });
  });
  document.getElementById('col-del-btn').addEventListener('click', () => {
    pushHistory();
    tbl.columns = tbl.columns.filter(c => c.id !== col.id);
    selId = null; selType = null; selParentId = null;
    refreshAll();
    toast('Column deleted', 'info');
  });
}

function buildRelProps(r) {
  const tableOptions = model.tables.map(t =>
    \`<option value="\${esc(t.logicalName)}">\${esc(t.displayName)} (\${esc(t.logicalName)})</option>\`
  ).join('');
  const fromVal = r.referencedTable || r.fromTable || '';
  const toVal   = r.referencingTable || r.toTable   || '';

  return \`
<div class="props-hdr">
  <div class="props-hdr-icon" style="background:var(--c-bg3);font-size:16px">⇄</div>
  <div class="props-hdr-name">Relationship</div>
  <span class="props-status-badge" style="background:var(--c-bg3);color:var(--c-text2)">\${esc(r.type||'1:N')}</span>
</div>
<div class="panel-body">
<div class="props-form">
  <div class="field-group">
    <label class="field-label">Type</label>
    <select class="field-select" id="rel-type">
      <option value="1:N" \${r.type==='1:N'?'selected':''}>1:N — One to Many</option>
      <option value="M:N" \${r.type==='M:N'?'selected':''}>M:N — Many to Many</option>
    </select>
  </div>
  <div class="field-group">
    <label class="field-label">Referenced Table (1 side / From)</label>
    <select class="field-select" id="rel-from">
      <option value="">— select —</option>
      \${model.tables.map(t => \`<option value="\${esc(t.logicalName)}" \${t.logicalName===fromVal?'selected':''}>\${esc(t.displayName)} (\${esc(t.logicalName)})</option>\`).join('')}
    </select>
  </div>
  <div class="field-group">
    <label class="field-label">Referencing Table (Many side / To)</label>
    <select class="field-select" id="rel-to">
      <option value="">— select —</option>
      \${model.tables.map(t => \`<option value="\${esc(t.logicalName)}" \${t.logicalName===toVal?'selected':''}>\${esc(t.displayName)} (\${esc(t.logicalName)})</option>\`).join('')}
    </select>
  </div>
  <div class="field-group">
    <label class="field-label">Relationship Label</label>
    <input class="field-input" id="rel-label" value="\${esc(r.label||'')}" placeholder="e.g. has, owns, belongs to">
  </div>
  <div class="field-group">
    <label class="field-label">FK Column Name (auto-generated)</label>
    <input class="field-input" id="rel-fk" value="\${esc(r.referencingAttribute||r.fkColumn||'')}" placeholder="e.g. cr123_contactid">
  </div>
  <button class="props-del-btn" id="rel-del-btn">
    <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M2 5h12l-1 9H3L2 5zm4-3h4v2H6V2zM1 3h14v2H1V3z"/></svg>
    Delete Relationship
  </button>
</div>
</div>\`;
}

function bindRelPropEvents(r) {
  function saveRel() {
    pushHistory();
    r.type = document.getElementById('rel-type').value;
    r.referencedTable  = document.getElementById('rel-from').value;
    r.fromTable        = r.referencedTable;
    r.referencingTable = document.getElementById('rel-to').value;
    r.toTable          = r.referencingTable;
    r.label            = document.getElementById('rel-label').value;
    r.referencingAttribute = document.getElementById('rel-fk').value;
    r.fkColumn         = r.referencingAttribute;
    refreshAll();
  }
  ['rel-type','rel-from','rel-to','rel-label','rel-fk'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveRel);
  });
  // Auto-generate FK column name
  document.getElementById('rel-from').addEventListener('change', () => {
    const from = document.getElementById('rel-from').value;
    const fkEl = document.getElementById('rel-fk');
    if (!fkEl.dataset.manuallyEdited && from) {
      fkEl.value = (model.publisherPrefix||'cr') + '_' + from.split('_').slice(1).join('_') + 'id';
    }
  });
  document.getElementById('rel-fk').addEventListener('input', () => {
    document.getElementById('rel-fk').dataset.manuallyEdited = '1';
  });
  document.getElementById('rel-del-btn').addEventListener('click', () => deleteRelationship(r.id));
}

/* ──────────────────────────────────────────────────────────────
   CRUD OPERATIONS
────────────────────────────────────────────────────────────── */
function addTable() {
  pushHistory();
  const prefix = model.publisherPrefix || 'cr';
  const n   = model.tables.length + 1;
  const id  = uid();
  const t = {
    id, logicalName: prefix + '_newtable' + n, displayName: 'New Table ' + n,
    description: '', status: 'new',
    columns: [{ id: uid(), logicalName: prefix + '_name', displayName: 'Name',
      type: 'SingleLine.Text', required: true, maxLength: 100 }]
  };
  model.tables.push(t);
  expandedTables.add(id);
  refreshAll();
  selectItem(id, 'table');
  toast('Table added', 'success');
}

function addColumn(tableId) {
  pushHistory();
  const tbl = model.tables.find(t => t.id === tableId);
  if (!tbl) return;
  const prefix = model.publisherPrefix || 'cr';
  const n   = (tbl.columns||[]).length + 1;
  const col = {
    id: uid(), logicalName: prefix + '_column' + n, displayName: 'Column ' + n,
    type: 'SingleLine.Text', required: false
  };
  tbl.columns = tbl.columns || [];
  tbl.columns.push(col);
  expandedTables.add(tableId);
  refreshAll();
  selectItem(col.id, 'column', tableId);
  toast('Column added', 'success');
}

function confirmDeleteTable(id) {
  const t = model.tables.find(x => x.id === id);
  if (!t) return;
  const relCount = (model.relationships||[]).filter(r =>
    r.referencedTable === t.logicalName || r.referencingTable === t.logicalName ||
    r.fromTable === t.logicalName || r.toTable === t.logicalName
  ).length;
  const msg = relCount > 0
    ? \`Delete "\${t.displayName}"? This will also remove \${relCount} relationship(s).\`
    : \`Delete table "\${t.displayName}"?\`;

  showConfirmModal(msg, 'Delete', () => {
    pushHistory();
    model.tables = model.tables.filter(x => x.id !== id);
    model.relationships = (model.relationships||[]).filter(r =>
      r.referencedTable !== t.logicalName && r.referencingTable !== t.logicalName &&
      r.fromTable !== t.logicalName && r.toTable !== t.logicalName
    );
    if (selId === id) { selId = null; selType = null; }
    refreshAll();
    toast('Table deleted', 'info');
  });
}

function deleteRelationship(id) {
  pushHistory();
  model.relationships = (model.relationships||[]).filter(r => r.id !== id);
  if (selId === id) { selId = null; selType = null; }
  refreshAll();
  toast('Relationship deleted', 'info');
}

function showAddRelationshipModal() {
  const tableOptions = model.tables.map(t =>
    \`<option value="\${esc(t.logicalName)}">\${esc(t.displayName)} (\${esc(t.logicalName)})</option>\`
  ).join('');

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = \`
<div class="modal">
  <div class="modal-hdr">
    <span class="modal-title">Add Relationship</span>
    <button class="modal-close" id="modal-close">✕</button>
  </div>
  <div class="modal-body">
    <div class="field-group">
      <label class="field-label">Relationship Type</label>
      <select class="field-select" id="new-rel-type">
        <option value="1:N">1:N — One to Many</option>
        <option value="M:N">M:N — Many to Many</option>
      </select>
    </div>
    <div class="field-group">
      <label class="field-label">From Table (Referenced / 1 side)</label>
      <select class="field-select" id="new-rel-from"><option value="">— select —</option>\${tableOptions}</select>
    </div>
    <div class="field-group">
      <label class="field-label">To Table (Referencing / Many side)</label>
      <select class="field-select" id="new-rel-to"><option value="">— select —</option>\${tableOptions}</select>
    </div>
    <div class="field-group">
      <label class="field-label">Label</label>
      <input class="field-input" id="new-rel-label" placeholder="e.g. has, owns">
    </div>
  </div>
  <div class="modal-ftr">
    <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-add">Add Relationship</button>
  </div>
</div>\`;
  document.body.appendChild(modal);

  modal.querySelector('#modal-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#new-rel-from').addEventListener('change', () => {
    const from = modal.querySelector('#new-rel-from').value;
    const lbl  = modal.querySelector('#new-rel-label');
    if (!lbl.value && from) {
      const prefix = model.publisherPrefix || 'cr';
      const fkGuess = prefix + '_' + from.split('_').slice(1).join('_') + 'id';
    }
  });
  modal.querySelector('#modal-add').addEventListener('click', () => {
    const type  = modal.querySelector('#new-rel-type').value;
    const from  = modal.querySelector('#new-rel-from').value;
    const to    = modal.querySelector('#new-rel-to').value;
    const label = modal.querySelector('#new-rel-label').value;
    if (!from || !to) { toast('Please select both tables', 'error'); return; }
    if (from === to)  { toast('From and To tables cannot be the same', 'error'); return; }
    pushHistory();
    const prefix = model.publisherPrefix || 'cr';
    const rel = {
      id: uid(), type, label,
      referencedTable: from, fromTable: from,
      referencingTable: to, toTable: to,
      referencingAttribute: prefix + '_' + from.split('_').slice(-1)[0] + 'id',
    };
    model.relationships = model.relationships || [];
    model.relationships.push(rel);
    modal.remove();
    refreshAll();
    selectItem(rel.id, 'relationship');
    toast('Relationship added', 'success');
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function showConfirmModal(message, confirmText, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = \`
<div class="modal" style="min-width:320px;max-width:420px">
  <div class="modal-hdr"><span class="modal-title">Confirm</span></div>
  <div class="modal-body"><p style="font-size:13px">\${esc(message)}</p></div>
  <div class="modal-ftr">
    <button class="btn btn-secondary" id="m-cancel">Cancel</button>
    <button class="btn btn-danger" id="m-confirm">\${esc(confirmText)}</button>
  </div>
</div>\`;
  document.body.appendChild(modal);
  modal.querySelector('#m-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#m-confirm').addEventListener('click', () => { modal.remove(); onConfirm(); });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

/* ──────────────────────────────────────────────────────────────
   FULL REFRESH
────────────────────────────────────────────────────────────── */
function refreshAll() {
  renderEntityList();
  renderProperties();
  updateStats();
  scheduleRender();
}

/* ──────────────────────────────────────────────────────────────
   UNDO / REDO
────────────────────────────────────────────────────────────── */
function undo() {
  if (!history.length) return;
  future.push(deepClone(model));
  model = history.pop();
  selId = null; selType = null;
  refreshAll();
  updateUndoRedo();
  toast('Undone', 'info');
}

function redo() {
  if (!future.length) return;
  history.push(deepClone(model));
  model = future.pop();
  selId = null; selType = null;
  refreshAll();
  updateUndoRedo();
  toast('Redone', 'info');
}

/* ──────────────────────────────────────────────────────────────
   CODE EDITOR (mermaid raw edit)
────────────────────────────────────────────────────────────── */
function applyMermaidCode(code) {
  const errEl = document.getElementById('code-err-msg');
  // Store Mermaid in model; diagram renders from it directly
  model.mermaidDiagram = code;
  if (errEl) errEl.textContent = '';
  isDirty = true;
  scheduleRender();
  toast('Mermaid code applied', 'info');
}

/* ──────────────────────────────────────────────────────────────
   ZOOM
────────────────────────────────────────────────────────────── */
function setZoom(z) {
  zoom = Math.max(0.2, Math.min(3, z));
  document.getElementById('mermaid-container').style.transform = \`scale(\${zoom})\`;
  document.getElementById('zoom-display').textContent = Math.round(zoom * 100) + '%';
}

/* ──────────────────────────────────────────────────────────────
   VIEW MODE
────────────────────────────────────────────────────────────── */
function setViewMode(mode) {
  viewMode = mode;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === mode));
  document.getElementById('visual-view').style.display = mode === 'visual' ? 'flex' : 'none';
  document.getElementById('code-view').style.display   = mode === 'code'   ? 'flex' : 'none';
  document.getElementById('split-view').style.display  = mode === 'split'  ? 'flex' : 'none';
  document.getElementById('visual-view').style.flexDirection = 'column';

  const code = buildMermaid(model);
  if (mode === 'code' || mode === 'split') {
    document.getElementById('code-editor').value = code;
    if (mode === 'split') document.getElementById('split-code-editor').value = code;
  }
  scheduleRender();
}

/* ──────────────────────────────────────────────────────────────
   APPROVE / CANCEL
────────────────────────────────────────────────────────────── */
async function approve() {
  const errs = validate(model);
  if (errs.length) {
    toast(errs[0], 'error');
    return;
  }
  model.mermaidDiagram = buildMermaid(model);
  document.getElementById('approve-btn').disabled = true;
  document.getElementById('approve-btn').innerHTML = \`
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
    Sending to Claude…\`;
  try {
    const res = await fetch('/api/approve', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(model)
    });
    const json = await res.json();
    if (json.ok) {
      document.getElementById('approve-btn').innerHTML = '✓ Approved! Claude is creating tables…';
      document.getElementById('approve-btn').style.background = 'var(--c-blue)';
      document.getElementById('approve-btn').style.borderColor = 'var(--c-blue)';
      toast('Data model approved! Claude will now create the Dataverse tables.', 'success');
    } else {
      throw new Error(json.error || 'Unknown error');
    }
  } catch (e) {
    toast('Failed to send: ' + e.message, 'error');
    document.getElementById('approve-btn').disabled = false;
    document.getElementById('approve-btn').innerHTML = \`
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 8l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
      Approve &amp; Create Tables\`;
  }
}

async function cancelEditor() {
  showConfirmModal('Cancel without saving? No tables will be created.', 'Cancel', async () => {
    try { await fetch('/api/cancel', { method: 'POST' }); } catch(_) {}
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:var(--fnt);color:var(--c-text2)">Editor closed. Return to Claude.</div>';
  });
}

/* ──────────────────────────────────────────────────────────────
   EXPORT
────────────────────────────────────────────────────────────── */
function exportJSON() {
  model.mermaidDiagram = buildMermaid(model);
  const blob = new Blob([JSON.stringify(model, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'er-datamodel.json';
  a.click();
  toast('JSON exported', 'success');
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */
function init() {
  // Attach button events
  document.getElementById('add-table-btn').addEventListener('click', addTable);
  document.getElementById('add-rel-btn').addEventListener('click', showAddRelationshipModal);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('redo-btn').addEventListener('click', redo);
  document.getElementById('approve-btn').addEventListener('click', approve);
  document.getElementById('cancel-btn').addEventListener('click', cancelEditor);
  document.getElementById('export-btn').addEventListener('click', exportJSON);

  document.getElementById('zoom-in-btn').addEventListener('click', () => setZoom(zoom + 0.2));
  document.getElementById('zoom-out-btn').addEventListener('click', () => setZoom(zoom - 0.2));
  document.getElementById('zoom-fit-btn').addEventListener('click', () => setZoom(1));
  document.getElementById('zoom-reset-btn').addEventListener('click', () => setZoom(1));

  document.getElementById('copy-mermaid-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(buildMermaid(model)).then(() => toast('Mermaid code copied!', 'success'));
  });

  document.querySelectorAll('.view-tab').forEach(t => {
    t.addEventListener('click', () => setViewMode(t.dataset.view));
  });

  document.getElementById('theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    mermaid.initialize({ startOnLoad: false, theme: dark ? 'default' : 'dark',
      er: { fontSize: 13, useMaxWidth: false }, securityLevel: 'loose' });
    scheduleRender();
  });

  document.getElementById('search-input').addEventListener('input', e => {
    searchQ = e.target.value;
    renderEntityList();
  });

  document.getElementById('code-apply-btn').addEventListener('click', () => {
    applyMermaidCode(document.getElementById('code-editor').value);
  });
  document.getElementById('code-reset-btn').addEventListener('click', () => {
    document.getElementById('code-editor').value = buildMermaid(model);
    document.getElementById('code-err-msg').textContent = '';
    toast('Code reset to current model', 'info');
  });
  document.getElementById('split-code-editor').addEventListener('input', e => {
    clearTimeout(e.target._timer);
    e.target._timer = setTimeout(() => {
      const code = e.target.value;
      model.mermaidDiagram = code;
      renderDiagram(document.getElementById('split-mermaid'), code);
    }, 600);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    if (ctrl && e.key === 'Enter') { e.preventDefault(); approve(); }
    if (e.key === 'Escape') { selId = null; selType = null; renderEntityList(); renderProperties(); }
  });

  // Expand tables that have selections
  for (const t of model.tables) {
    if (model.tables.length <= 5) expandedTables.add(t.id);
  }

  refreshAll();
}

init();
<\/script>
</body>
</html>`;
}
