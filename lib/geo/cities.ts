/** Major cities theo ISO2 (curate cho các nước hay ship). Không đủ mọi TP —
 *  form cho phép free-entry khi TP không có trong list. */
export const CITIES_BY_ISO: Record<string, string[]> = {
  US: [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
    'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Seattle',
    'Boston', 'San Francisco', 'Atlanta', 'Miami', 'Washington', 'Las Vegas',
    'Denver', 'Portland', 'Nashville', 'Oklahoma City', 'El Paso', 'Louisville',
    'Memphis', 'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson', 'Minneapolis',
  ],
  CA: [
    'Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa',
    'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener', 'London', 'Halifax',
    'Victoria', 'Oshawa', 'Windsor', 'Saskatoon', 'Regina', 'Markham',
    'Mississauga', 'Burnaby', 'Surrey', 'Laval', 'Brampton', 'Gatineau',
  ],
  GB: [
    'London', 'Birmingham', 'Manchester', 'Glasgow', 'Liverpool', 'Leeds',
    'Sheffield', 'Edinburgh', 'Bristol', 'Leicester', 'Coventry', 'Nottingham',
    'Bradford', 'Kingston upon Hull', 'Belfast', 'Cardiff', 'Stoke-on-Trent',
    'Wolverhampton', 'Plymouth', 'Southampton', 'Reading', 'Derby', 'Newcastle upon Tyne',
    'Brighton', 'Portsmouth', 'Oxford', 'Cambridge', 'York',
  ],
  AU: [
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast',
    'Canberra', 'Newcastle', 'Sunshine Coast', 'Wollongong', 'Hobart',
    'Geelong', 'Townsville', 'Cairns', 'Darwin', 'Toowoomba', 'Ballarat',
    'Bendigo', 'Launceston', 'Mackay', 'Rockhampton', 'Bunbury',
  ],
  FR: [
    'Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg',
    'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Toulon',
    'Saint-Étienne', 'Le Havre', 'Grenoble', 'Dijon', 'Angers', 'Nîmes',
    'Clermont-Ferrand', 'Aix-en-Provence', 'Brest', 'Tours', 'Amiens',
    'Limoges', 'Villeurbanne', 'Metz', 'Besançon',
  ],
  DE: [
    'Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Stuttgart',
    'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig', 'Bremen', 'Dresden',
    'Hanover', 'Nuremberg', 'Duisburg', 'Bochum', 'Wuppertal', 'Bielefeld',
    'Bonn', 'Mannheim', 'Karlsruhe', 'Augsburg', 'Wiesbaden', 'Münster',
    'Gelsenkirchen', 'Aachen', 'Mönchengladbach', 'Braunschweig', 'Kiel',
  ],
  JP: [
    'Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe',
    'Kawasaki', 'Kyoto', 'Saitama', 'Hiroshima', 'Sendai', 'Kitakyushu',
    'Chiba', 'Sakai', 'Niigata', 'Hamamatsu', 'Kumamoto', 'Sagamihara',
    'Okayama', 'Shizuoka', 'Kagoshima', 'Funabashi', 'Hachioji',
    'Matsuyama', 'Utsunomiya', 'Higashiosaka', 'Nara', 'Kanazawa',
  ],
  KR: [
    'Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju', 'Suwon',
    'Ulsan', 'Changwon', 'Goyang', 'Yongin', 'Seongnam', 'Bucheon',
    'Ansan', 'Cheongju', 'Jeonju', 'Anyang', 'Cheonan', 'Namyangju',
    'Hwaseong', 'Uijeongbu', 'Jeju City', 'Pohang', 'Gimhae',
  ],
  SG: [
    'Singapore', 'Jurong East', 'Woodlands', 'Tampines', 'Sengkang',
    'Punggol', 'Choa Chu Kang', 'Hougang', 'Yishun', 'Bedok',
    'Queenstown', 'Bukit Batok', 'Toa Payoh', 'Ang Mo Kio', 'Bukit Merah',
    'Geylang', 'Kallang', 'Clementi', 'Bishan', 'Pasir Ris',
  ],
  CN: [
    'Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Tianjin',
    'Wuhan', 'Xi\'an', 'Hangzhou', 'Suzhou', 'Nanjing', 'Qingdao',
    'Chongqing', 'Dongguan', 'Shenyang', 'Harbin', 'Jinan', 'Foshan',
    'Zhengzhou', 'Kunming', 'Changsha', 'Wenzhou', 'Dalian', 'Nanchang',
    'Changchun', 'Ningbo', 'Hefei', 'Fuzhou', 'Shijiazhuang',
  ],
  HK: [
    'Hong Kong', 'Kowloon', 'Tsuen Wan', 'Sha Tin', 'Tuen Mun',
    'Yuen Long', 'Tai Po', 'Fanling', 'Tseung Kwan O', 'Kwun Tong',
    'Wong Tai Sin', 'Sham Shui Po', 'Yau Tsim Mong', 'Central', 'Wan Chai',
    'North Point', 'Causeway Bay', 'Aberdeen', 'Stanley',
  ],
  TH: [
    'Bangkok', 'Nonthaburi', 'Pak Kret', 'Hat Yai', 'Chiang Mai',
    'Phra Nakhon Si Ayutthaya', 'Nakhon Ratchasima', 'Khon Kaen',
    'Udon Thani', 'Chon Buri', 'Nakhon Si Thammarat', 'Ubon Ratchathani',
    'Songkhla', 'Chiang Rai', 'Rayong', 'Pattaya', 'Phuket',
    'Nakhon Sawan', 'Lampang', 'Surat Thani',
  ],
  MY: [
    'Kuala Lumpur', 'George Town', 'Ipoh', 'Shah Alam', 'Petaling Jaya',
    'Johor Bahru', 'Kota Kinabalu', 'Kuching', 'Subang Jaya', 'Selayang',
    'Ampang Jaya', 'Klang', 'Iskandar Puteri', 'Kota Bharu', 'Kuala Terengganu',
    'Alor Setar', 'Seremban', 'Miri', 'Sandakan', 'Seri Kembangan',
    'Sibu', 'Taiping', 'Tawau', 'Batu Pahat',
  ],
  PH: [
    'Manila', 'Quezon City', 'Caloocan', 'Davao', 'Cebu City', 'Zamboanga',
    'Antipolo', 'Taguig', 'Pasig', 'Valenzuela', 'Las Piñas', 'Makati',
    'Parañaque', 'Bacoor', 'General Santos', 'Cagayan de Oro', 'Pasay',
    'Muntinlupa', 'Malabon', 'Mandaluyong', 'Bacolod', 'Iloilo City',
    'San Jose del Monte', 'Calamba', 'Imus', 'Marikina',
  ],
  VN: [
    'Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
    'Nha Trang', 'Huế', 'Biên Hòa', 'Vũng Tàu', 'Quy Nhơn',
    'Thủ Đức', 'Buôn Ma Thuột', 'Long Xuyên', 'Thái Nguyên',
    'Nam Định', 'Vinh', 'Rạch Giá', 'Đà Lạt', 'Mỹ Tho', 'Bắc Ninh',
  ],
  SA: [
    'Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar',
    'Dhahran', 'Taif', 'Tabuk', 'Buraidah', 'Abha', 'Hail',
    'Hofuf', 'Jubail', 'Yanbu', 'Khamis Mushait', 'Najran',
    'Arar', 'Sakaka', 'Jizan',
  ],
  AE: [
    'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Al Ain', 'Ras Al Khaimah',
    'Fujairah', 'Umm Al Quwain', 'Khor Fakkan', 'Kalba',
    'Madinat Zayed', 'Ruwais', 'Liwa', 'Dibba Al Fujairah',
    'Al Hamriyah', 'Jebel Ali',
  ],
  QA: [
    'Doha', 'Al Rayyan', 'Al Wakrah', 'Al Khor', 'Umm Salal',
    'Al Shahaniya', 'Madinat ash Shamal', 'Al Daayen', 'Mesaieed',
    'Lusail', 'Dukhan', 'Al Wukair',
  ],
  KW: [
    'Kuwait City', 'Salmiya', 'Hawalli', 'Farwaniya', 'Jahra',
    'Ahmadi', 'Mangaf', 'Mahboula', 'Fintas', 'Abu Halifa',
    'Sabah Al Salem', 'Ar Riqqah', 'Ar Rumaythiyah', 'Bayan',
    'Rumaithiya', 'Al Fahaheel', 'Ardiyah',
  ],
  IL: [
    'Jerusalem', 'Tel Aviv', 'Haifa', 'Rishon LeZion', 'Petah Tikva',
    'Ashdod', 'Netanya', 'Beer Sheva', 'Bnei Brak', 'Holon',
    'Ramat Gan', 'Rehovot', 'Bat Yam', 'Ashkelon', 'Beit Shemesh',
    'Kfar Saba', 'Herzliya', 'Hadera', 'Modiin', 'Nazareth',
    'Lod', 'Ra\'anana', 'Acre', 'Eilat',
  ],
};

export function citiesFor(iso2: string): string[] {
  return CITIES_BY_ISO[(iso2 ?? '').trim().toUpperCase()] ?? [];
}
