const db = require('./db');

// Penyimpanan in-memory sementara untuk pesan simulasi WhatsApp agar bisa diakses cepat oleh frontend simulator
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
 * Mendapatkan OTP terbaru untuk nomor WhatsApp tertentu (digunakan oleh auto-fill frontend)
 */
function dapatkanOtpTerbaru(noWhatsapp) {
  // Bersihkan noWhatsapp dari karakter non-digit untuk pencocokan yang aman
  const cleanPhone = noWhatsapp.replace(/\D/g, '');
  const pesanOtp = listPesanSimulasi.find(p => 
    p.tipe === 'otp' && 
    p.no_whatsapp.replace(/\D/g, '') === cleanPhone
  );

  if (pesanOtp) {
    // Cari kode OTP 6 digit dari teks pesan
    const match = pesanOtp.pesan.match(/\*(\d{6})\*/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Mendapatkan semua pesan simulasi untuk ditampilkan di HP Simulator frontend
 */
function dapatkanSemuaPesanSimulasi(noWhatsapp) {
  if (!noWhatsapp) return listPesanSimulasi;
  const cleanPhone = noWhatsapp.replace(/\D/g, '');
  return listPesanSimulasi.filter(p => p.no_whatsapp.replace(/\D/g, '') === cleanPhone);
}

module.exports = {
  buatKodeOTP,
  kirimOTP,
  kirimPengingatJadwal,
  dapatkanOtpTerbaru,
  dapatkanSemuaPesanSimulasi,
  listPesanSimulasi
};
