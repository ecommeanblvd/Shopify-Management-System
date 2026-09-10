/**
 * Bóc tệp tải lên thành từng file bên trong: .msg (email hoá đơn điện tử) → đính kèm, .zip → nội dung, còn lại → chính nó.
 * Đọc thẳng .msg để khỏi phải giải nén tay và khỏi đọc chữ từ PDF (dễ sai số).
 * Thuần: chỉ biến đổi bộ nhớ, không chạm DB/mạng.
 */
import AdmZip from 'adm-zip';
import MsgReader from '@kenjiuno/msgreader';

export function bocZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  try {
    for (const e of new AdmZip(buf).getEntries()) if (!e.isDirectory) out.set(e.entryName, e.getData());
  } catch { /* không phải zip hợp lệ */ }
  return out;
}

export function bocMsg(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // MsgReader nhận ArrayBuffer; Buffer của Node có thể là view của pool lớn hơn nên phải cắt đúng đoạn.
  const reader = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const data = reader.getFileData();
  for (const att of data.attachments ?? []) {
    const ten = att.fileName ?? att.name ?? 'khong-ten';
    try {
      const noiDung = Buffer.from(reader.getAttachment(att).content);
      out.set(ten, noiDung);
      if (/\.zip$/i.test(ten)) for (const [t, b] of bocZip(noiDung)) out.set(`${ten}/${t}`, b);
    } catch { /* đính kèm hỏng thì bỏ qua, các file khác vẫn dùng được */ }
  }
  return out;
}

/** Gom mọi file từ một tệp tải lên. */
export function bocTep(tenFile: string, buf: Buffer): Map<string, Buffer> {
  if (/\.msg$/i.test(tenFile)) return bocMsg(buf);
  if (/\.zip$/i.test(tenFile)) return bocZip(buf);
  return new Map([[tenFile, buf]]);
}
