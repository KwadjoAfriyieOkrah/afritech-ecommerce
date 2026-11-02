'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { ApiError } from '@/services/api';
import {
  bulkImportProducts,
  type BulkImportResult,
  type BulkSummary
} from '@/services/adminApi';

function SummaryPanel({ summary }: { summary: BulkSummary }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: 'Rows read', value: summary.totalRows },
    { label: 'Valid rows', value: summary.validRows },
    { label: 'Invalid rows', value: summary.invalidRows },
    { label: 'New products', value: summary.creates },
    { label: 'Updated products', value: summary.updates },
    { label: 'Stock adjustments', value: summary.stockAdjustments }
  ];

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {row.label}
          </dt>
          <dd className="mt-1 text-lg font-bold text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdminBulkUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkImportResult | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const isBusy = isPreviewing || isImporting;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const handlePreview = async (): Promise<void> => {
    if (!file || isBusy) return;

    setIsPreviewing(true);
    setPreview(null);
    setResult(null);
    setError(null);

    try {
      setPreview(await bulkImportProducts(file, false));
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async (): Promise<void> => {
    if (!file || !preview || preview.errors.length > 0 || isBusy) return;

    setIsImporting(true);
    setResult(null);
    setError(null);

    try {
      setResult(await bulkImportProducts(file, true));
    } catch (caught) {
      setError(ApiError.from(caught).message);
    } finally {
      setIsImporting(false);
    }
  };

  const canImport =
    file !== null &&
    preview !== null &&
    preview.errors.length === 0 &&
    !preview.committed &&
    !isBusy;

  const helpText =
    file === null
      ? 'Choose a CSV file to begin.'
      : preview === null
        ? 'Click Preview to check the file.'
        : preview.errors.length > 0
          ? 'Fix the rows listed below, then preview again.'
          : `Ready to import ${preview.summary.validRows} products.`;

  return (
    <section className="flex flex-col gap-4">
      <Link href="/admin/products" className="btn btn-ghost w-fit px-0 text-sm">
        Back to products
      </Link>

      <div>
        <h2 className="text-xl font-bold text-ink">Bulk upload</h2>
        <p className="text-sm text-stone-500">
          Preview a CSV first. Import is enabled only when the preview has no errors.
        </p>
      </div>

      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <label htmlFor="csv-file" className="label">
            CSV file
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={isBusy}
            className="block w-full text-sm text-stone-600"
          />
          {file && <p className="mt-2 text-sm text-stone-500">Selected: {file.name}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={!file || isBusy}
            className="btn btn-outline px-3 py-2 text-sm"
          >
            {isPreviewing ? 'Previewing...' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={!canImport}
            className="btn btn-primary px-3 py-2 text-sm"
          >
            {isImporting ? 'Importing...' : 'Import products'}
          </button>
        </div>

        <p role="status" className="text-sm text-stone-600">
          {helpText}
        </p>
      </div>

      {error && (
        <div role="alert" className="alert-error">
          <p>{error}</p>
        </div>
      )}

      {preview && (
        <div className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h3 className="text-lg font-semibold text-ink">Preview</h3>
            <p className="text-sm text-stone-500">
              {preview.errors.length === 0
                ? 'No errors found. You can import this file.'
                : `${preview.errors.length} row${preview.errors.length === 1 ? '' : 's'} need attention.`}
            </p>
          </div>

          <SummaryPanel summary={preview.summary} />

          {preview.errors.length > 0 && (
            <div>
              <h4 className="font-medium text-ink">Row errors</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {preview.errors.map((rowError) => (
                  <li
                    key={rowError.row}
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <p className="font-semibold">Row {rowError.row}</p>
                    <ul className="mt-1 list-inside list-disc">
                      {rowError.errors.map((detail, index) => (
                        <li key={`${rowError.row}-${detail.field}-${index}`}>
                          {detail.field}: {detail.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="card flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <h3 className="text-lg font-semibold text-ink">Import result</h3>
            <p className="text-sm text-stone-500">
              {result.committed
                ? 'The products were imported.'
                : 'Nothing was imported. Fix the row errors and preview again.'}
            </p>
          </div>

          <SummaryPanel summary={result.summary} />

          {result.errors.length > 0 && (
            <div>
              <h4 className="font-medium text-ink">Row errors</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {result.errors.map((rowError) => (
                  <li
                    key={rowError.row}
                    className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  >
                    <p className="font-semibold">Row {rowError.row}</p>
                    <ul className="mt-1 list-inside list-disc">
                      {rowError.errors.map((detail, index) => (
                        <li key={`${rowError.row}-${detail.field}-${index}`}>
                          {detail.field}: {detail.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
