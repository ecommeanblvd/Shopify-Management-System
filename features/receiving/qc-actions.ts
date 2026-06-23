'use server';
import { revalidatePath } from 'next/cache';
import { recordQc, uploadReceiptImage } from '@/features/receiving/actions';

function revalidateQc(): void {
  revalidatePath('/f/warehouse/qc');
  revalidatePath('/f/warehouse/receiving', 'layout'); // gồm cả receiving/[id]
}

export async function qcPassAction(formData: FormData): Promise<void> {
  await recordQc({ itemId: String(formData.get('itemId')), qcResult: 'pass' });
  revalidateQc();
}

export async function qcFailAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId'));
  let key: string | null = null;
  const file = formData.get('failPhoto');
  if (file instanceof File && file.size > 0) {
    const fd = new FormData(); fd.set('file', file); fd.set('scope', itemId);
    key = await uploadReceiptImage(fd);
  }
  await recordQc({
    itemId,
    qcResult: 'fail',
    qcFailReason: String(formData.get('reason') ?? ''),
    qcFailPhotoKey: key,
  });
  revalidateQc();
}
