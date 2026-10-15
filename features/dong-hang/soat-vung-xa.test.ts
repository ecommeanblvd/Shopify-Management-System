import { describe, expect, it } from 'vitest';
import { cauCanhBaoVungXa } from './soat-vung-xa';

describe('cauCanhBaoVungXa', () => {
  /* Câu này là thứ nhân sự đọc rồi quyết định có mở cổng hãng ra kiểm hay không. Thiếu tên
   * thành phố thì họ không biết soi cái gì. */
  it('khớp theo tên thành phố → nêu đúng tên đã dùng để hỏi giá', () => {
    const c = cauCanhBaoVungXa('Tier B', 'city', 'Al Bukayriyah');
    expect(c).toMatch(/Al Bukayriyah/);
    expect(c).toMatch(/Tier B/);
  });
  it('khớp theo mã bưu chính → không bịa ra chuyện tên thành phố', () => {
    const c = cauCanhBaoVungXa(null, 'postcode', 'Shoreline');
    expect(c).toMatch(/mã bưu chính/);
    expect(c).not.toMatch(/Shoreline/);
  });
  /* Bảng ODA của mình có thể cũ hơn của hãng, và hãng có quyền không thu. Câu chữ PHẢI là
   * "có thể thiếu, vào kiểm", tuyệt đối không được khẳng định hãng tính sai — nhân sự sẽ đi
   * cãi với hãng bằng một con số của mình. */
  it('nói "CÓ THỂ thiếu" và bảo đi kiểm, KHÔNG khẳng định hãng sai', () => {
    const c = cauCanhBaoVungXa('Tier A', 'city', 'X');
    expect(c).toMatch(/có thể/i);
    expect(c).toMatch(/kiểm/);
    expect(c).not.toMatch(/sai/);
  });
  /* Bậc là thông tin thêm; không có bậc thì câu vẫn phải đọc được, không để lại "()" trống. */
  it('không có bậc thì không để lại ngoặc rỗng', () => {
    expect(cauCanhBaoVungXa(null, 'city', 'X')).not.toMatch(/\(\)/);
  });
});
