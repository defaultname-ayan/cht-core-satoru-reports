import { Injectable, NgZone } from '@angular/core';
import * as _ from 'lodash-es';

import { DbService } from '@mm-services/db.service';
import { FormatDateService } from '@mm-services/format-date.service';
import { LanguageService } from '@mm-services/language.service';
import { SettingsService } from '@mm-services/settings.service';
import { TranslateLocaleService } from '@mm-services/translate-locale.service';

import * as messages from '@medic/message-utils';
import * as registrationUtils from '@medic/registration-utils';

@Injectable({
  providedIn: 'root'
})
export class FormatDataRecordService {
  constructor(
    private dbService:DbService,
    private formatDateService:FormatDateService,
    private languageService:LanguageService,
    private settingsService:SettingsService,
    private translateLocaleService:TranslateLocaleService,
    private ngZone:NgZone,
  ) {
  }

  private readonly patientFields = ['patient_id', 'patient_uuid', 'patient_name'];
  private readonly placeFields = ['place_id'];

  private getRegistrations(shortcode) {
    if (!shortcode) {
      return;
    }

    const options = {
      key: shortcode,
      include_docs: true,
    };
    return this.dbService
      .get()
      .query('medic-client/reports_by_subject', options)
      .then((result) => {
        return _.uniqBy(result.rows.map(row => row.doc), '_id');
      });
  }

  private fieldsToHtml(
    settings,
    doc,
    keys,
    labels?,
    locale?,
    data?,
    def?
  ) {
    if (!def && doc && doc.form) {
      def = this.getForm(settings, doc.form);
    }

    if (_.isString(def)) {
      def = this.getForm(settings, def);
    }

    if (!data) {
      data = Object.assign({}, doc, doc.fields);
    }

    const fields = {
      headers: [] as { head: any }[],
      data: [] as any[],
    };

    _.forEach(keys, (key) => {
      if (Array.isArray(key)) {
        const result:any = this.fieldsToHtml(settings, doc, key[1], labels, locale, data[key[0]], def);
        result.isArray = true;
        fields.data.push(result);
        fields.headers.push({ head: this.titleize(key[0]) });
      } else {
        const label = labels.shift();
        fields.headers.push({ head: this.getMessage(settings, label) });
        if (def && def[key]) {
          def = def[key];
        }
        fields.data.push({
          isArray: false,
          value: this.prettyVal(settings, data, key, def, locale),
          label: label,
          target: this.getClickTarget(key, doc)
        });
      }
    });

    return fields;
  }

  private getClickTarget(key, doc) {
    if (this.patientFields.includes(key)) {
      const id = doc.patient?._id || doc.fields?.patient_uuid;
      if (id) {
        return { url: ['/contacts', id] };
      }
    } else if (key === 'case_id') {
      const id = doc.case_id || doc.fields?.case_id;
      if (id) {
        return { filter: `case_id:${id}` };
      }
    } else if (this.placeFields.includes(key)) {
      const id = doc.place?._id;
      if (id) {
        return { url: ['/contacts', id] };
      }
    }
  }

  /*
    * Get an array of keys from the form.  If dot notation is used it will be an
    * array of arrays.
  *
  * @param Object def - form definition
  *
  * @return Array  - form field keys based on forms definition
  */
  private getFormKeys(def) {
    const keys = {};

    const getKeys = (key, hash) => {
      if (key.length > 1) {
        const tmp = key.shift();
        if (!hash[tmp]) {
          hash[tmp] = {};
        }
        getKeys(key, hash[tmp]);
      } else {
        hash[key[0]] = '';
      }
    };

    const hashToArray = (hash) => {
      const array: (string | any[])[] = [];

      _.forEach(hash, (value, key) => {
        if (typeof value === 'string') {
          array.push(key);
        } else {
          array.push([key, hashToArray(hash[key])]);
        }
      });

      return array;
    };

    if (def) {
      Object
        .keys(def.fields)
        .forEach((key) => {
          getKeys(key.split('.'), keys);
        });
    }

    return hashToArray(keys);
  }

  private translateKey(settings, key, field, locale) {
    let label;
    if (field) {
      label = this.getMessage(
        settings,
        field.labels && field.labels.short,
        locale
      );
    } else {
      label = this.translate(settings, key, locale);
    }
    // still haven't found a proper label; then titleize
    if (key === label) {
      return this.titleize(key);
    }
    return label;
  }

  // returns the deepest array from `key`
  private unrollKey(array) {
    let target: any[] = [].concat(array);
    const root: any[] = [];

    while (Array.isArray(_.last(target))) {
      root.push(_.first(target));
      target = _.last(target);
    }

    return target.map((item) => {
      return root.concat([item]).join('.');
    });
  }

  /**
  * Return a title-case version of the supplied string.
  * @name titleize(str)
  * @param str The string to transform.
  * @returns {String}
  */
  private titleize(s) {
    return s
      .trim()
      .toLowerCase()
      .replace(/([a-z\d])([A-Z]+)/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .replace(/_/g, ' ')
      .replace(/(?:^|\s|-)\S/g, (c) => {
        return c.toUpperCase();
      });
  }

  private formatDateField(date, field) {
    if (!date) {
      return;
    }
    let formatted;
    let relative;
    if (['child_birth_date', 'birth_date', 'lmp_date', 'expected_date', 'bs_date'].includes(field)) {
      formatted = this.formatDateService.date(date);
      relative = this.formatDateService.relative(date, { withoutTime: true });
    } else {
      formatted = this.formatDateService.datetime(date);
      relative = this.formatDateService.relative(date);
    }
    return formatted + ' (' + relative + ')';
  }

  /*
  * @param {Object} data_record - typically a data record or portion (hash)
  * @param {String} key - key for field
                                  * @param {Object} def - form or field definition
  */
  private prettyVal(settings, data_record, key, def, locale) {
    if (
      !data_record ||
      _.isUndefined(key) ||
      _.isUndefined(data_record[key])
    ) {
      return;
    }

    const val = data_record[key];

    if (!def) {
      return val;
    }

    if (def.fields && def.fields[key]) {
      def = def.fields[key];
    }

    if (def.type === 'boolean') {
      return val === true ? 'True' : 'False';
    }
    if (['date', 'bsDate', 'bsAggreDate'].includes(def.type)) {
      return this.formatDateField(data_record[key], key);
    }
    if (def.type === 'integer') {
      // use list value for month
      if (def.validate && def.validate.is_numeric_month) {
        if (def.list) {
          for (const i in def.list) {
            if (Object.prototype.hasOwnProperty.call(def.list, i)) {
              const item = def.list[i];
              if (item[0] === val) {
                return this.translate(settings, item[1], locale);
              }
            }
          }
        }
      }
    }
    return val;
  }

  private translate(settings, key, locale?, ctx?, skipInterpolation?) {
    if (_.isObject(key)) {
      return this.getMessage(settings, key, locale) || key;
    }

    return this.translateLocaleService.instant(key, ctx, locale, skipInterpolation);
  }

  /*
    * With some forms like patient registration, we add additional data to
    * it based on other form submissions.  Form data from other reports is used to
    * create these fields and it is useful to show these new fields in the data
    * records screen/render even though they are not defined in the form.
  */
  private includeNonFormFieldsJson (settings, doc, formKeys, locale) {
    const fields = [
      'mother_outcome',
      'child_birth_outcome',
      'child_birth_weight',
      'child_birth_date',
      'expected_date',
      'birth_date',
      'patient_id',
      'case_id'
    ];

    const dateFields = ['child_birth_date', 'expected_date', 'birth_date'];

    fields.forEach((field) => {
      let value = doc[field];

      // Only include the property if we find it on the doc and not as a form
      // key since then it would be duplicated.
      if (!value || formKeys.indexOf(field) !== -1) {
        return;
      }

      const label = this.translate(settings, field, locale);
      if (dateFields.includes(field)) {
        value = this.formatDateField(value, field);
      }

      doc.fields.data.unshift({
        label,
        value,
        isArray: false,
        generated: true,
        target: this.getClickTarget(field, doc)
      });

      doc.fields.headers.unshift({
        head: label,
      });
    });
  }

  private includeNonFormFieldsXml(doc, fields) {
    const generatedFields = [
      'patient_id',
      'case_id'
    ];

    generatedFields.forEach((field) => {
      const value = doc[field];
      if (!value) {
        return;
      }
      fields.unshift({
        label: field,
        value,
        generated: true,
        target: this.getClickTarget(field, doc)
      });
    });
  }

  private getGroupName(task) {
    if (task.group) {
      return task.type + ':' + task.group;
    }
    return task.type;
  }

  private getGroupDisplayName(settings, task, language) {
    if (task.translation_key) {
      return this.translate(settings, task.translation_key, language, {
        group: task.group,
      });
    }
    return this.getGroupName(task);
  }

  /*
    * Fetch labels from translation strings or jsonform object, maintaining order
    * in the returned array.
  *
  * @param Array keys - keys we want to resolve labels for
  * @param String form - form code string
  * @param String locale - locale string, e.g. 'en', 'fr', 'en-gb'
  *
  * @return Array  - form field labels based on forms definition.
  *
  * @api private
  */
  private getLabels(settings, keys, form, locale) {
    const def = this.getForm(settings, form);
    const fields = def && def.fields;

    return _.reduce(
      keys,
      (memo: any[], key) => {
        const field = fields && fields[key];

        if (_.isString(key)) {
          memo.push(this.translateKey(settings, key, field, locale));
        } else if (Array.isArray(key)) {
          _.forEach(this.unrollKey(key), (key) => {
            const field = fields && fields[key];
            memo.push(this.translateKey(settings, key, field, locale));
          });
        }

        return memo;
      },
      []
    );
  }

  private getForm(settings, code) {
    return settings.forms && settings.forms[code];
  }

  private getMessage(settings, value:any, locale?) {
    const _findTranslation = (value, locale) => {
      if (value.translations) {
        const translation = _.find(value.translations, { locale: locale });
        return translation && translation.content;
      }
      // fallback to old translation definition to support
      // backwards compatibility with existing forms
      return value[locale];
    };

    if (!_.isObject(value)) {
      return value;
    }

    let test = false;
    if (locale === 'test') {
      test = true;
      locale = 'en';
    }

    // todo check why the any cast on top is not enough
    const anyValue:any = value;

    let result =
      // 0) does it have a translation_key
      (anyValue.translation_key &&
        this.translate(settings, anyValue.translation_key, locale)) ||
      // 1) Look for the requested locale
      _findTranslation(value, locale) ||
      // 2) Look for the default
      anyValue.default ||
      // 3) Look for the English value
      _findTranslation(value, 'en') ||
      // 4) Look for the first translation
      (anyValue.translations &&
        anyValue.translations[0] &&
        anyValue.translations[0].content) ||
      // 5) Look for the first value
      value[_.first(Object.keys(value))!];

    if (test) {
      result = '-' + result + '-';
    }

    return result;
  }

  private getImagePath(doc, label, value) {
    if (!doc?._attachments) {
      return undefined;
    }
    const isImagePath = filePath => doc._attachments[filePath]?.content_type?.startsWith('image/');
    const filePath = 'user-file-' + value;
    if (isImagePath(filePath)) {
      return filePath;
    }
    const labelParts = label.split('.').slice(1);
    const binaryFilePath = labelParts
      .slice(1)
      .reduce(
        // Properly encode positional indicator
        (path, part) => /^\d+$/.test(part) ? `${path}[${Number(part) + 1}]` : `${path}/${part}`,
        'user-file/fields'
      );
    if (isImagePath(binaryFilePath)) {
      return binaryFilePath;
    }
    // Fall back to the old style of naming image attachments
    const legacyFilePath = 'user-file/' + labelParts.join('/');
    if (isImagePath(legacyFilePath)) {
      return legacyFilePath;
    }
    return undefined;
  }

  /*
   * Satoru scale-report enhancement.
   *
   * Forms listed in settings.report_display get a human-readable rendering:
   *   - configured internal/calculation fields are removed from display
   *   - choice values (yes/P/F/pass/...) are resolved to the labels defined
   *     in the form definition (map shipped in the config, generated from
   *     the form XML)
   *   - note fields (disclaimer) get their label text as the value
   *   - chronological-age helper fields are joined into one readable row
   *   - per-item scores are attached to their question row
   *   - empty leaf fields are suppressed (presentation only - nothing is
   *     removed from the CouchDB doc)
   *
   * Forms NOT in the config keep the stock rendering exactly.
   */
  private getReportDisplayConfig(settings, form) {
    const cfg = settings?.report_display?.[form];
    return cfg && typeof cfg === 'object' ? cfg : null;
  }

  private scaleFieldPath(label: string, prefix: string): string | null {
    return label.indexOf(prefix) === 0 ? label.slice(prefix.length) : null;
  }

  private lookupField(values: any, path: string) {
    if (!values) {
      return undefined;
    }
    return path.split('.').reduce((acc, part) => {
      return acc && acc[part] !== undefined ? acc[part] : undefined;
    }, values);
  }

  private formatScaleDate(value: any) {
    try {
      const formatted = this.formatDateService.date(value);
      return formatted || value;
    } catch (e) {
      return value;
    }
  }

  private formatScaleAgeParts(days: any) {
    const d = Number(days);
    if (!Number.isFinite(d) || d < 0) {
      return null;
    }
    const years = Math.floor(d / 365.25);
    const months = Math.floor((d - years * 365.25) / 30.4375);
    const yearLabel = years === 1 ? 'year' : 'years';
    const monthLabel = months === 1 ? 'month' : 'months';
    if (years <= 0 && months <= 0) {
      return `${d} days`;
    }
    if (years <= 0) {
      return `${months} ${monthLabel}`;
    }
    return `${years} ${yearLabel} ${months} ${monthLabel}`;
  }

  private getScaleDisplayFields(doc, settings, cfg) {
    let fields = this.getDisplayFields(doc);
    const prefix = 'report.' + doc.form + '.';
    const hidden: string[] = cfg.hide_fields || [];
    const keepEmpty: string[] = cfg.keep_empty || [];
    const joins = cfg.join_fields || [];
    const scoreFields = cfg.score_fields || {};
    const noteValues = cfg.note_values || {};
    const choiceMap = cfg.choice_map || {};
    const dateFields: string[] = cfg.date_fields || [];

    // remove configured internal fields (full path or whole subtree)
    if (hidden.length) {
      fields = fields.filter((field) => {
        const path = this.scaleFieldPath(field.label, prefix);
        if (path === null) {
          return true;
        }
        return !hidden.some((h) => path === h || path.indexOf(h + '.') === 0);
      });
    }

    const out: any[] = [];
    fields.forEach((field) => {
      const path = this.scaleFieldPath(field.label, prefix);

      if (path !== null && 'value' in field) {
        // resolve choice value -> human label from the form definition
        const map = choiceMap[path];
        if (map && typeof field.value === 'string' && map[field.value]) {
          field.value = map[field.value];
        } else if (dateFields.includes(path) && field.value) {
          field.value = this.formatScaleDate(field.value);
        }

        // note fields: stored value is empty; show the form's note text
        if (noteValues[path] !== undefined) {
          field.value = noteValues[path];
        }

        // join chronological-age helper fields into one readable row
        const join = joins.find((j) => j.target === path);
        if (join) {
          if (join.label) {
            field.label = join.label; // human label, not the calc-field key
          }
          if (join.format === 'years_months_parts') {
            const years = this.lookupField(doc.fields, join.parts[0]);
            const months = this.lookupField(doc.fields, join.parts[1]);
            if (years !== undefined && months !== undefined) {
              field.value = `${years} ${Number(years) === 1 ? 'year' : 'years'} ` +
                `${months} ${Number(months) === 1 ? 'month' : 'months'}`;
            }
          } else if (join.format === 'days_to_years_months') {
            const days = this.lookupField(doc.fields, join.parts[0]);
            const composed = this.formatScaleAgeParts(days);
            if (composed) {
              field.value = composed;
            }
          }
        }

        // attach per-item score to its question row
        const scorePath = scoreFields[path];
        if (scorePath) {
          const score = this.lookupField(doc.fields, scorePath);
          if (score !== undefined && score !== '') {
            field.score = score;
          }
        }

        // suppress empty presentation rows
        if (cfg.suppress_empty
          && (field.value === '' || field.value === undefined || field.value === null)
          && keepEmpty.indexOf(path) === -1) {
          return;
        }
      }
      out.push(field);
    });
    return out;
  }

  private getFields(doc, results, values, labelPrefix, depth) {
    if (depth > 3) {
      depth = 3;
    }
    Object
      .keys(values)
      .forEach((key) => {
        const value = values[key];
        const label = labelPrefix + '.' + key;
        if (_.isObject(value)) {
          results.push({ label, depth });
          this.getFields(doc, results, value, label, depth + 1);
        } else {
          results.push({
            label,
            value,
            depth,
            target: this.getClickTarget(key, doc),
            imagePath: this.getImagePath(doc, label, value),
          });
        }
      });
    return results;
  }

  private getDisplayFields(doc) {
    // calculate fields to display
    if (!doc.fields) {
      return [];
    }
    const label = 'report.' + doc.form;
    const fields = this.getFields(doc, [], doc.fields, label, 0);
    this.includeNonFormFieldsXml(doc, fields);
    const hiddenLabels = ['inputs', ...doc.hidden_fields || []].map(field => `${label}.${field}`);
    const isHidden = (fieldLabel: string) => {
      // Drop any position indicators for arrays (e.g. repeat.1.field > repeat.field)
      const positionlessLabel = fieldLabel.replace(/\.\d+(?=\.|$)/g, '');
      return hiddenLabels.some(hidden => positionlessLabel === hidden || positionlessLabel.startsWith(`${hidden}.`));
    };
    return fields.filter(field => !isHidden(field.label));
  }

  private formatXmlFields(doc, settings?) {
    const cfg = settings && this.getReportDisplayConfig(settings, doc.form);
    doc.fields = cfg ? this.getScaleDisplayFields(doc, settings, cfg) : this.getDisplayFields(doc);
  }

  private formatJsonFields(doc, settings, language) {
    if (!doc.form) {
      return;
    }
    const keys = this.getFormKeys(this.getForm(settings, doc.form));
    const labels = this.getLabels(settings, keys, doc.form, language);
    doc.fields = this.fieldsToHtml(settings, doc, keys, labels, language);
    this.includeNonFormFieldsJson(settings, doc, keys, language);
  }

  private formatScheduledTasks(doc, settings, language, context) {
    const scheduledTasksByGroup:Array<{ group; name; type; number; rows; rows_sorted }> = [];
    const groups = {};
    doc.scheduled_tasks.forEach((task) => {
      if (!task) {
        return;
      }

      const copy = _.clone(task);
      const content = {
        translationKey: task.message_key,
        message: task.message,
      };

      if (!copy.messages) {
        // backwards compatibility
        copy.messages = messages.generate(
          settings,
          (key, locale?) => this.translate(settings, key, locale, null, true),
          doc,
          content,
          task.recipient,
          context
        );

        if (messages.hasError(copy.messages)) {
          copy.error = true;
        }
      }

      // timestamp is used for sorting in the frontend
      if (task.timestamp) {
        copy.timestamp = task.timestamp;
      } else if (task.due) {
        copy.timestamp = task.due;
      }

      // translation key used to identify translatable messages
      if (task.message_key) {
        copy.message_key = task.message_key;
      }

      const groupName = this.getGroupName(task);
      let group = groups[groupName];
      if (!group) {
        const displayName = this.getGroupDisplayName(settings, task, language);
        groups[groupName] = group = {
          group: groupName,
          name: displayName,
          type: task.type,
          number: task.group,
          rows: [],
        };
      }
      group.rows.push(copy);
    });
    Object.keys(groups).forEach((key) => {
      groups[key].rows_sorted = _.sortBy(groups[key].rows, 'timestamp');
      scheduledTasksByGroup.push(groups[key]);
    });

    return scheduledTasksByGroup;
  }

  /*
    * Prepare outgoing messages for render. Reduce messages to organize by
    * properties: sent_by, from, state and message.  This helps for easier
    * display especially in the case of bulk sms.
    *
    * messages = [
  *    {
    *       recipients: [
  *          {
    *              to: '+123',
    *              facility: <facility>,
    *              timestamp: <timestamp>,
    *              uuid: <uuid>,
  *          },
  *          ...
  *        ],
  *        sent_by: 'admin',
  *        from: '+998',
  *        state: 'sent',
  *        message: 'good morning'
  *    }
  *  ]
  */
  private formatOutgoingMessages(doc) {
    const outgoing_messages: {
      recipients: any[];
      sent_by: any;
      from: any;
      state: any;
      message: any;
    }[] = [];
    const outgoing_messages_recipients: Record<string, any>[] = [];
    doc.tasks.forEach((task) => {
      task.messages.forEach((msg) => {
        const recipient = {
          to: msg.to,
          facility: msg.facility,
          timestamp: task.timestamp,
          uuid: msg.uuid,
        };
        let done = false;
        // append recipient to existing
        outgoing_messages.forEach((m) => {
          if (
            msg.message === m.message &&
            msg.sent_by === m.sent_by &&
            msg.from === m.from &&
            task.state === m.state
          ) {
            m.recipients.push(recipient);
            outgoing_messages_recipients.push(recipient);
            done = true;
          }
        });
        // create new entry
        if (!done) {
          outgoing_messages.push({
            recipients: [recipient],
            sent_by: msg.sent_by,
            from: msg.from,
            state: task.state,
            message: msg.message,
          });
          outgoing_messages_recipients.push(recipient);
        }
      });
    });
    doc.outgoing_messages = outgoing_messages;
    doc.outgoing_messages_recipients = outgoing_messages_recipients;
  }

  /*
    * Take data record document and return nice formated JSON object.
  */
  private makeDataRecordReadable(doc, settings, language, context) {
    const formatted = _.clone(doc);

    if (formatted.content_type === 'xml') {
      this.formatXmlFields(formatted, settings);
    } else {
      this.formatJsonFields(formatted, settings, language);
    }

    if (formatted.scheduled_tasks) {
      formatted.scheduled_tasks_by_group =this.formatScheduledTasks(doc, settings, language, context);
    }

    if (formatted.kujua_message) {
      this.formatOutgoingMessages(formatted);
    }

    return formatted;
  }

  format(doc) {
    return this.ngZone.runOutsideAngular(() => this._format(doc));
  }

  private _format(doc) {
    const patientId = doc.patient_id || doc.fields?.patient_id || doc.patient?.patient_id;
    const placeId = doc.place_id || doc.fields?.place_id || doc.place?.place_id;

    return Promise
      .all([
        this.settingsService.get(),
        this.languageService.get(),
        doc.scheduled_tasks && this.getRegistrations(patientId),
        doc.scheduled_tasks && this.getRegistrations(placeId),
      ])
      .then(([ settings, language, patientRegistrations=[], placeRegistrations=[] ]) => {
        const context:any = {};

        if (doc.patient) {
          context.patient = doc.patient;
          context.registrations = patientRegistrations.filter((registration) => {
            return registrationUtils.isValidRegistration(registration, settings);
          });
        }

        if (doc.place) {
          context.place = doc.place;
          context.placeRegistrations = placeRegistrations.filter((registration) => {
            return registrationUtils.isValidRegistration(registration, settings);
          });
        }

        return this.makeDataRecordReadable(doc, settings, language, context);
      });
  }
}

