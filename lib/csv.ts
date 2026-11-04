/**
 * A small RFC4180 CSV reader. No dependency, because the files are small and
 * the failure modes here need to be our own error messages, not a library's.
 */

export type CsvTable = {
  header: string[];
  /** One record per row, keyed by header name, values untrimmed. */
  rows: Record<string, string>[];
  /** 1-based line number in the source file, per row, for error messages. */
  lineNumbers: number[];
};

export function parseCsv(text: string): CsvTable {
  const records = splitRecords(text);
  if (records.length === 0) throw new Error("the file is empty");

  const header = records[0]!.fields.map((f) => f.trim());
  if (header.length === 0 || header.every((h) => h === "")) {
    throw new Error("the first line has no column names");
  }

  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];
  for (const record of records.slice(1)) {
    // A trailing newline produces one empty record; ignore it rather than
    // reporting a bogus "wrong number of columns" error.
    if (record.fields.length === 1 && record.fields[0]!.trim() === "") continue;
    if (record.fields.length !== header.length) {
      throw new Error(
        `line ${record.line}: has ${record.fields.length} values but the header has ${header.length} columns`,
      );
    }
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = record.fields[i]!;
    });
    rows.push(row);
    lineNumbers.push(record.line);
  }
  return { header, rows, lineNumbers };
}

function splitRecords(text: string): { fields: string[]; line: number }[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const records: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ fields, line: recordLine });
    fields = [];
    recordLine = line + 1;
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRecord();
      line++;
    } else if (ch === "\r") {
      // part of CRLF; the \n does the work
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error(`line ${recordLine}: a quoted value is never closed`);
  if (field !== "" || fields.length > 0) endRecord();
  return records;
}
