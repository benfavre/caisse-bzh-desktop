import { printIdentity } from './print-jobs.mjs';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function receiptHtml(document) {
  if (!printIdentity(document) || !['sale', 'refund', 'z', 'service'].includes(document.kind) || !Array.isArray(document.blocks) || !document.blocks.length || document.blocks.length > 600) throw new Error('Invalid print document');
  const blocks = document.blocks.map(block => {
    if (!block || typeof block.text !== 'string' || block.text.length > 500 || (block.right !== undefined && (typeof block.right !== 'string' || block.right.length > 500))) throw new Error('Invalid print block');
    const style = ['normal', 'title', 'small', 'rule'].includes(block.style) ? block.style : 'normal';
    return '<div class="' + style + (block.align === 'center' ? ' center' : '') + '"><span>' + escape(block.text) + '</span>' + (block.right !== undefined ? '<span>' + escape(block.right) + '</span>' : '') + '</div>';
  }).join('');
  return '<!doctype html><html lang="fr"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Ticket caisse.bzh</title><style>@page{size:80mm auto;margin:3mm}body{width:72mm;margin:0;color:#000;background:#fff;font:12px monospace}div{display:flex;justify-content:space-between;gap:8px;break-inside:avoid;overflow-wrap:anywhere}.center{justify-content:center;text-align:center}.title{font-size:17px;font-weight:bold;margin:6px 0}.small{font-size:10px}.rule{border-top:1px dashed black;margin:6px 0}span:last-child:not(:first-child){flex-shrink:0;text-align:right}</style><body>' + blocks + '</body></html>';
}
