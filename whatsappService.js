const db = require('./db');

// Penyimpanan in-memory sementara untuk pesan simulasi WhatsApp.
// Di mode standalone (lokal/Render/Glitch) ini utama dipakai untuk akses cepat.
// Di mode serverless (Vercel) ini hanya cache sementara per-instance;
// pembacaan tetap di-fallback ke database cloud supaya konsisten lintas instance.
let listPesanSimulasi = [];

/**
 * Membuat kode OTP acak 6 digit
 */
function buatKodeOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Simulasi mengirim pesan WhatsApp
 * Menyimpan pesan ke database cloud 'pengingat' dan antrean in-memory untuk visualisasi di UI
 */
async function kirimWhatsApp(noWhatsapp, pesan, tipe, idMatakuliah = null) {
  console.log(`\n========================================`);
  console.log(`[SIMULASI WHATSAPP] Dikirim ke: ${noWhatsapp}`);
  console.log(`[TIPE]: ${tipe}`);
  console.log(`[PESAN]:\n${pesan}`);
  console.log(`========================================\n`);

  // Tambahkan ke antrean in-memory untuk simulator frontend (maksimal 100 pesan terakhir)
  const pesanBaru = {
    id: Date.now() + Math.random(),
    no_whatsapp: noWhatsapp,
    pesan: pesan,
    tipe: tipe,
    dikirim_pada: new Date()
  };
  
  listPesanSimulasi.unshift(pesanBaru);
  if (listPesanSimulasi.length > 100) {
    listPesanSimulasi.pop();
  }

  // Simpan ke database cloud PostgreSQL agar data tersinkronisasi
  // dan tetap bisa dibaca kembali bahkan di environment serverless (Vercel)
  try {
    await db.query(
      `INSERT INTO pengingat (id_matakuliah, no_whatsapp, pesan, status, tipe)
       VALUES ($1, $2, $3, $4, $5)`,
      [idMatakuliah, noWhatsapp, pesan, 'sukses', tipe]
    );
  } catch (error) {
    console.error('Gagal mencatat pengingat ke database:', error);
  }

  return true;
}

/**
 * Mengirim OTP untuk registrasi
 */
async function kirimOTP(noWhatsapp, kodeOtp) {
  const pesan = `Halo! Kode OTP Anda untuk registrasi Pengingat Jadwal Kuliah adalah: *${kodeOtp}*. Berlaku selama 5 menit. Tolong jangan sebarkan kode ini kepada siapa pun.`;
  return kirimWhatsApp(noWhatsapp, pesan, 'otp');
}

/**
 * Mengirim pengingat jadwal kuliah (10 menit sebelum kelas dimulai)
 */
async function kirimPengingatJadwal(noWhatsapp, namaPenerima, namaMk, jamMulai, ruangan, kodeMk, namaDosen) {
  const pesan = `⚠️ *PENGINGAT JADWAL KULIAH* ⚠️\n\nHalo *${namaPenerima}*,\n\nMata kuliah berikut akan dimulai dalam *10 menit*:\n\n📚 *Mata Kuliah*: ${namaMk} (${kodeMk})\n⏰ *Jam*: ${jamMulai}\n🏫 *Ruangan*: ${ruangan}\n👤 *Dosen Pengampu*: ${namaDosen}\n\nMohon segera bersiap-siap untuk mengikuti perkuliahan. Terima kasih!`;
  return kirimWhatsApp(noWhatsapp, pesan, 'notifikasi_jadwal');
}

/**
 * Membersihkan nomor WhatsApp dari karakter non-digit
 */
function normalisasiNoWa(no) {
  return (no || '').toString().replace(/\D/g, '');
}

/**
 * Mendapatkan OTP terbaru untuk nomor WhatsApp tertentu (digunakan oleh auto-fill frontend)
 * Strategi: cek in-memory dulu (cepat), kalau kosong fallback ke database.
 */
async function dapatkanOtpTerbaru(noWhatsapp) {
  const cleanPhone = normalisasiNoWa(noWhatsapp);

  // 1. Cek in-memory dulu
  const pesanOtpMemory = listPesanSimulasi.find(p =>
    p.tipe === 'otp' &&
    normalisasiNoWa(p.no_whatsapp) === cleanPhone
  );
  if (pesanOtpMemory) {
    const match = pesanOtpMemory.pesan.match(/\*(\d{6})\*/);
    if (match) return match[1];
  }

  // 2. Fallback ke database (penting untuk Vercel yang stateless)
  try {
    const hasil = await db.query(
      `SELECT pesan FROM pengingat
       WHERE tipe = 'otp' AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(no_whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE '%' || $1
       ORDER BY dikirim_pada DESC
       LIMIT 1`,
      [cleanPhone]
    );
    if (hasil.rows.length > 0) {
      const match = hasil.rows[0].pesan.match(/\*(\d{6})\*/);
      if (match) return match[1];
    }
  } catch (e) {
    console.error('Gagal mengambil OTP dari database:', e);
  }

  return null;
}

/**
 * Mendapatkan semua pesan simulasi untuk ditampilkan di HP Simulator frontend
 * Strategi: cek in-memory dulu, kalau kosong ambil dari database.
 */
async function dapatkanSemuaPesanSimulasi(noWhatsapp) {
  // 1. Kalau tidak ada nomor spesifik, ambil semua dari memory
  if (!noWhatsapp) {
    if (listPesanSimulasi.length > 0) return listPesanSimulasi;
    // Fallback DB
    try {
      const hasil = await db.query(
        `SELECT no_whatsapp, pesan, tipe, dikirim_pada FROM pengingat
         ORDER BY dikirim_pada DESC LIMIT 100`
      );
      return hasil.rows.map(r => ({
        no_whatsapp: r.no_whatsapp,
        pesan: r.pesan,
        tipe: r.tipe,
        dikirim_pada: r.dikirim_pada
      }));
    } catch (e) {
      console.error('Gagal ambil pesan dari DB:', e);
      return [];
    }
  }

  // 2. Ada nomor spesifik
  const cleanPhone = normalisasiNoWa(noWhatsapp);
  const dariMemory = listPesanSimulasi.filter(p =>
    normalisasiNoWa(p.no_whatsapp) === cleanPhone
  );
  if (dariMemory.length > 0) return dariMemory;

  // 3. Fallback DB
  try {
    const hasil = await db.query(
      `SELECT no_whatsapp, pesan, tipe, dikirim_pada FROM pengingat
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(no_whatsapp, '+', ''), '-', ''), ' ', ''), '(', ''), ')', '') LIKE '%' || $1
       ORDER BY dikirim_pada DESC LIMIT 100`,
      [cleanPhone]
    );
    return hasil.rows.map(r => ({
      no_whatsapp: r.no_whatsapp,
      pesan: r.pesan,
      tipe: r.tipe,
      dikirim_pada: r.dikirim_pada
    }));
  } catch (e) {
    console.error('Gagal ambil pesan dari DB:', e);
    return [];
  }
}

module.exports = {
  buatKodeOTP,
  kirimOTP,
  kirimPengingatJadwal,
  dapatkanOtpTerbaru,
  dapatkanSemuaPesanSimulasi,
  listPesanSimulasi
};
