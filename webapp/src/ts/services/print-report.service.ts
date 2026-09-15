import { Injectable } from '@angular/core';

import { TranslateService } from '@mm-services/translate.service';

/**
 * Print/Save-as-PDF for the Reports view.
 *
 * Renders the SAME formatted, human-readable field rows the report detail
 * UI displays (selection.formatted.fields, already produced by
 * FormatDataRecordService with the scale-report config applied) into a
 * dedicated print container and triggers the browser's print dialog
 * (Save as PDF). No separate data representation: the printout always
 * matches what the user sees.
 */
@Injectable({ providedIn: 'root' })
export class PrintReportService {

  constructor(
    private readonly translateService: TranslateService,
  ) {
  }

  printSelection(selection: any, title: string): void {
    const doc = selection?.formatted;
    if (!doc) {
      return;
    }

    const printContainer = this.ensureContainer();
    printContainer.innerHTML = '';

    printContainer.appendChild(this.buildStyles());

    printContainer.appendChild(this.buildHeader(doc, title));

    const rows = this.collectRows(doc);
    // xml reports carry translation keys as labels - same rule the
    // reports-content template uses ({{field.label | translate}})
    printContainer.appendChild(this.buildRows(rows, doc.content_type === 'xml'));

    // wait for layout, print, then remove the container
    setTimeout(() => {
      window.print();
      setTimeout(() => printContainer.remove(), 300);
    }, 100);
  }

  private ensureContainer(): HTMLElement {
    let el = document.getElementById('report-print-view');
    if (!el) {
      el = document.createElement('div');
      el.id = 'report-print-view';
      document.body.appendChild(el);
    }
    return el;
  }

  private buildStyles(): HTMLElement {
    const style = document.createElement('style');
    style.textContent = `
      @media print {
        body > app-root { display: none !important; }
        #report-print-view { display: block !important; }
      }
      #report-print-view {
        display: none;
        font-family: 'Noto Sans', 'Open Sans', Arial, sans-serif;
        color: #1a1a1a;
        margin: 1cm;
      }
      #report-print-view h1 { font-size: 16pt; margin: 0 0 4px; }
      #report-print-view .printed-meta { color: #555; font-size: 9pt; margin-bottom: 12px; }
      #report-print-view .section-head {
        font-size: 11pt; font-weight: 600; margin: 14px 0 4px;
        border-bottom: 1px solid #999; padding-bottom: 2px;
      }
      #report-print-view .row { margin: 2px 0; page-break-inside: avoid; }
      #report-print-view .row .label { font-weight: 600; }
      #report-print-view .row .value { margin-left: 8px; }
      #report-print-view .row.depth-0 { margin-top: 6px; }
      #report-print-view .score-badge { font-weight: 600; }
    `;
    return style;
  }

  private escape(text: any): string {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private buildHeader(doc: any, title: string): HTMLElement {
    const header = document.createElement('div');
    const subject = doc.patient?.name || doc.fields?.patient_name
      || doc.contact?.name || '';
    header.innerHTML = `
      <h1>${this.escape(title)}</h1>
      <div class="printed-meta">
        ${subject ? `Participant: ${this.escape(subject)} &nbsp; ` : ''}
        Printed: ${new Date().toLocaleString()}
      </div>
    `;
    return header;
  }

  private collectRows(doc: any): any[] {
    const rows: any[] = [];
    const walk = (fields: any[]) => fields?.forEach((f) => {
      rows.push(f);
      if (f.isArray && Array.isArray(f.data)) {
        walk(f.data);
      }
    });
    if (doc.content_type !== 'xml' && doc.fields?.data) {
      walk(doc.fields.data);
    } else {
      walk(doc.fields);
    }
    return rows;
  }

  private label(field: any, translateLabels: boolean): string {
    const raw = field.label ?? '';
    if (!translateLabels || !raw) {
      return raw;
    }
    const translated = this.translateService.instant(raw);
    // ngx-translate echoes the key back when it has no entry for it
    return translated === raw ? raw : translated;
  }

  private buildRows(rows: any[], translateLabels: boolean): HTMLElement {
    const wrap = document.createElement('div');
    rows.forEach((field) => {
      if (field.value === undefined && !field.isArray) {
        // group header row
        const head = document.createElement('div');
        head.className = `section-head depth-${field.depth || 0}`;
        head.textContent = this.label(field, translateLabels);
        wrap.appendChild(head);
        return;
      }
      const row = document.createElement('div');
      row.className = `row depth-${field.depth || 0}`;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = this.label(field, translateLabels);
      row.appendChild(label);
      if (field.score !== undefined) {
        const score = document.createElement('span');
        score.className = 'score-badge';
        score.textContent = ` — Score: ${field.score}`;
        row.appendChild(score);
      }
      if (field.value !== undefined) {
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = `: ${field.value}`;
        row.appendChild(value);
      }
      wrap.appendChild(row);
    });
    return wrap;
  }
}
