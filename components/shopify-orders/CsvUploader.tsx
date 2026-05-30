'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload } from 'lucide-react';

export interface UploadResult {
  inserted: number;
  overwritten: number;
  errors: Array<{ line: number; message: string }>;
}

interface CsvUploaderProps {
  uploadAction: (formData: FormData) => Promise<UploadResult>;
  expectedHeaders: string[];
  hint: string;
}

export function CsvUploader({ uploadAction, expectedHeaders, hint }: CsvUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (form: FormData): Promise<void> => {
    setBusy(true);
    setResult(await uploadAction(form));
    setBusy(false);
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="text-xs text-muted-foreground">
          Required headers: <span className="font-mono">{expectedHeaders.join(', ')}</span>. {hint}
        </div>
        <form action={onSubmit} className="space-y-3">
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            required
          />
          <Button type="submit" disabled={!file || busy} size="sm" className="gap-1.5">
            <Upload className="size-3.5" />
            {busy ? 'Importing…' : 'Import CSV'}
          </Button>
        </form>
        {result && (
          <div className="text-sm space-y-1">
            <div>Inserted: <span className="font-mono">{result.inserted}</span></div>
            <div>Overwritten: <span className="font-mono">{result.overwritten}</span></div>
            {result.errors.length > 0 && (
              <details>
                <summary className="text-destructive">{result.errors.length} errors</summary>
                <ul className="text-xs font-mono mt-1 space-y-0.5">
                  {result.errors.map((e, i) => <li key={i}>line {e.line}: {e.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
