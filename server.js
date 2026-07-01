const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');
const waService = require('./whatsappService');

// Deteksi environment: Vercel (serverless) vs lokal/standalone
const isVercel = !!process.env.VERCEL;
const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// node-cron hanya dipakai di mode standalone (lokal/Render/Glitch).
// Di Vercel (serverless), cron dijalankan via endpoint /api/cron yang dipicu
// eksternal (cron-job.org) setiap menit.
let cron = null;
if (!isServerless) {
  try { cron = require('node-cron'); } catch (e) { /* optional dep */ }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Static file serving: di Vercel otomatis di-handle, di lokal pakai express.static
if (!isVercel) {
  app.use(express.static('public'));
}

// Middleware sederhana untuk autentikasi token (menggunakan Base64 string dari id pengguna untuk demo tanpa JWT kompleks)
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ pesan: 'Autentikasi diperlukan. Silakan login terlebih dahulu.' });
    }
    const token = authHeader.split(' ')[1];
    // Decode token (format: id_pengguna)
    const userId = parseInt(Buffer.from(token, 'base64').toString('utf-8'), 10);
    if (!userId) {
      return res.status(401).json({ pesan: 'Token tidak valid.' });
    }

    const hasil = await db.query('SELECT * FROM pengguna WHERE id = $1', [userId]);
    if (hasil.rows.length === 0) {
      return res.status(401).json({ pesan: 'Pengguna tidak ditemukan.' });
    }

    req.pengguna = hasil.rows[0];
    next();
  } catch (error) {
    console.error('Error di authMiddleware:', error);
    res.status(500).json({ pesan: 'Terjadi kesalahan sistem pada autentikasi.' });
  }
};

// ==========================================
// 1. API AUTENTIKASI & REGISTRASI
// ==========================================

// Mengirimkan kode OTP ke nomor WhatsApp
app.post('/api/auth/kirim-otp', async (req, res) => {
  const { no_whatsapp, nama, kata_sandi, peran } = req.body;

  if (!no_whatsapp || !nama || !kata_sandi || !peran) {
    return res.status(400).json({ pesan: 'Semua field wajib diisi.' });
  }

  try {
    // Cek apakah nomor WhatsApp sudah terdaftar dan terverifikasi
    const cekUser = await db.query('SELECT * FROM pengguna WHERE no_whatsapp = $1', [no_whatsapp]);
    if (cekUser.rows.length > 0 && cekUser.rows[0].apakah_diverifikasi) {
      return res.status(400).json({ pesan: 'Nomor WhatsApp sudah terdaftar.' });
    }

    const kodeOtp = waService.buatKodeOTP();
    const otpKedaluwarsa = new Date(Date.now() + 5 * 60 * 1000); // Berlaku 5 menit
    const hashKataSandi = await bcrypt.hash(kata_sandi, 10);

    if (cekUser.rows.length > 0) {
      // Update data user yang belum terverifikasi
      await db.query(
        `UPDATE pengguna 
         SET nama = $1, hash_kata_sandi = $2, peran = $3, kode_otp = $4, otp_kedaluwarsa = $5, apakah_diverifikasi = FALSE
         WHERE no_whatsapp = $6`,
        [nama, hashKataSandi, peran, kodeOtp, otpKedaluwarsa, no_whatsapp]
      );
    } else {
      // Simpan pengguna baru dengan status belum terverifikasi
      await db.query(
        `INSERT INTO pengguna (no_whatsapp, nama, hash_kata_sandi, peran, kode_otp, otp_kedaluwarsa, apakah_diverifikasi) 
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
        [no_whatsapp, nama, hashKataSandi, peran, kodeOtp, otpKedaluwarsa]
      );
    }

    // Kirim OTP via WhatsApp Simulator secara otomatis
    await waService.kirimOTP(no_whatsapp, kodeOtp);

    res.json({ pesan: 'Kode OTP berhasil dikirim ke nomor WhatsApp Anda secara otomatis.' });
  } catch (error) {
    console.error('Error saat kirim OTP:', error);
    res.status(500).json({ pesan: 'Gagal mengirim OTP. Terjadi kesalahan pada server.' });
  }
});

// Verifikasi OTP dan selesaikan pendaftaran
app.post('/api/auth/daftar', async (req, res) => {
  const { no_whatsapp, kode_otp } = req.body;

  if (!no_whatsapp || !kode_otp) {
    return res.status(400).json({ pesan: 'Nomor WhatsApp dan kode OTP wajib diisi.' });
  }

  try {
    const hasil = await db.query('SELECT * FROM pengguna WHERE no_whatsapp = $1', [no_whatsapp]);
    if (hasil.rows.length === 0) {
      return res.status(404).json({ pesan: 'Pengguna tidak ditemukan. Silakan kirim OTP terlebih dahulu.' });
    }

    const pengguna = hasil.rows[0];

    // Cek kecocokan OTP
    if (pengguna.kode_otp !== kode_otp) {
      return res.status(400).json({ pesan: 'Kode OTP salah. Silakan periksa kembali.' });
    }

    // Cek kedaluwarsa OTP
    if (new Date() > new Date(pengguna.otp_kedaluwarsa)) {
      return res.status(400).json({ pesan: 'Kode OTP telah kedaluwarsa. Silakan kirim ulang OTP.' });
    }

    // Verifikasi sukses, aktifkan akun
    await db.query(
      `UPDATE pengguna 
       SET apakah_diverifikasi = TRUE, kode_otp = NULL, otp_kedaluwarsa = NULL 
       WHERE no_whatsapp = $1`,
      [no_whatsapp]
    );

    res.json({ pesan: 'Pendaftaran akun berhasil! Silakan masuk (login).' });
  } catch (error) {
    console.error('Error saat verifikasi pendaftaran:', error);
    res.status(500).json({ pesan: 'Gagal memverifikasi pendaftaran.' });
  }
});

// Login Pengguna
app.post('/api/auth/masuk', async (req, res) => {
  const { no_whatsapp, kata_sandi } = req.body;

  if (!no_whatsapp || !kata_sandi) {
    return res.status(400).json({ pesan: 'Nomor WhatsApp dan kata sandi wajib diisi.' });
  }

  try {
    const hasil = await db.query('SELECT * FROM pengguna WHERE no_whatsapp = $1', [no_whatsapp]);
    if (hasil.rows.length === 0) {
      return res.status(400).json({ pesan: 'Nomor WhatsApp atau kata sandi salah.' });
    }

    const pengguna = hasil.rows[0];

    if (!pengguna.apakah_diverifikasi) {
      return res.status(400).json({ pesan: 'Akun Anda belum terverifikasi. Silakan lakukan registrasi ulang.' });
    }

    const cocok = await bcrypt.compare(kata_sandi, pengguna.hash_kata_sandi);
    if (!cocok) {
      return res.status(400).json({ pesan: 'Nomor WhatsApp atau kata sandi salah.' });
    }

    // Buat token sederhana (Base64 dari ID Pengguna)
    const token = Buffer.from(pengguna.id.toString()).toString('base64');

    res.json({
      pesan: 'Login berhasil!',
      token: token,
      pengguna: {
        id: pengguna.id,
        no_whatsapp: pengguna.no_whatsapp,
        nama: pengguna.nama,
        peran: pengguna.peran,
        pilihan_tema: pengguna.pilihan_tema
      }
    });
  } catch (error) {
    console.error('Error saat login:', error);
    res.status(500).json({ pesan: 'Gagal melakukan login.' });
  }
});

// Mendapatkan info profil diri sendiri (Session Check)
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    pengguna: {
      id: req.pengguna.id,
      no_whatsapp: req.pengguna.no_whatsapp,
      nama: req.pengguna.nama,
      peran: req.pengguna.peran,
      pilihan_tema: req.pengguna.pilihan_tema
    }
  });
});

// ==========================================
// 2. API MATA KULIAH
// ==========================================

// Mendapatkan daftar mata kuliah berdasarkan Peran
app.get('/api/matakuliah', authMiddleware, async (req, res) => {
  try {
    const { id, peran } = req.pengguna;

    if (peran === 'dosen') {
      // Dosen melihat mata kuliah yang diampunya sendiri beserta daftar mahasiswanya
      const hasil = await db.query(
        `SELECT mk.*, p.nama AS nama_dosen 
         FROM matakuliah mk 
         JOIN pengguna p ON mk.id_dosen = p.id 
         WHERE mk.id_dosen = $1 
         ORDER BY mk.hari, mk.jam_mulai`,
        [id]
      );
      
      // Ambil daftar mahasiswa untuk masing-masing matakuliah
      const matakuliahDosen = [];
      for (let mk of hasil.rows) {
        const mhsHasil = await db.query(
          `SELECT p.id, p.nama, p.no_whatsapp 
           FROM pengguna p 
           JOIN pendaftaran_mk pm ON p.id = pm.id_mahasiswa 
           WHERE pm.id_matakuliah = $1`,
          [mk.id]
        );
        matakuliahDosen.push({
          ...mk,
          daftar_mahasiswa: mhsHasil.rows
        });
      }
      return res.json(matakuliahDosen);

    } else if (peran === 'mahasiswa') {
      // Mahasiswa melihat mata kuliah yang ia ambil (diikuti)
      const hasil = await db.query(
        `SELECT mk.*, p.nama AS nama_dosen 
         FROM matakuliah mk 
         JOIN pengguna p ON mk.id_dosen = p.id 
         JOIN pendaftaran_mk pm ON mk.id = pm.id_matakuliah 
         WHERE pm.id_mahasiswa = $1 
         ORDER BY mk.hari, mk.jam_mulai`,
        [id]
      );
      return res.json(hasil.rows);

    } else if (peran === 'admin') {
      // Admin melihat semua mata kuliah di sistem beserta dosen & statistik mahasiswa
      const hasil = await db.query(
        `SELECT mk.*, p.nama AS nama_dosen, 
         (SELECT COUNT(*) FROM pendaftaran_mk WHERE id_matakuliah = mk.id) AS total_mahasiswa 
         FROM matakuliah mk 
         JOIN pengguna p ON mk.id_dosen = p.id 
         ORDER BY mk.hari, mk.jam_mulai`
      );
      return res.json(hasil.rows);
    }
  } catch (error) {
    console.error('Error saat mengambil matakuliah:', error);
    res.status(500).json({ pesan: 'Gagal mengambil data mata kuliah.' });
  }
});

// Mendapatkan semua daftar mata kuliah yang tersedia di kampus (untuk menu ambil jadwal mahasiswa / admin)
app.get('/api/matakuliah/semua', authMiddleware, async (req, res) => {
  try {
    const hasil = await db.query(
      `SELECT mk.*, p.nama AS nama_dosen 
       FROM matakuliah mk 
       JOIN pengguna p ON mk.id_dosen = p.id 
       ORDER BY mk.nama_mk`
    );
    res.json(hasil.rows);
  } catch (error) {
    console.error('Error mengambil semua matakuliah:', error);
    res.status(500).json({ pesan: 'Gagal mengambil seluruh daftar mata kuliah.' });
  }
});

// Dosen menambahkan mata kuliah baru (dengan kode_mk otomatis/kustom)
app.post('/api/matakuliah', authMiddleware, async (req, res) => {
  const { nama_mk, hari, jam_mulai, jam_selesai, ruangan, kode_mk_kustom } = req.body;
  const { id, peran } = req.pengguna;

  if (peran !== 'dosen' && peran !== 'admin') {
    return res.status(403).json({ pesan: 'Hanya dosen atau admin yang dapat membuat mata kuliah.' });
  }

  if (!nama_mk || !hari || !jam_mulai || !jam_selesai || !ruangan) {
    return res.status(400).json({ pesan: 'Semua field (nama, hari, jam, ruangan) wajib diisi.' });
  }

  try {
    // Generate kode mata kuliah jika tidak diisi manual
    let kodeMk = kode_mk_kustom ? kode_mk_kustom.trim().toUpperCase() : '';
    if (!kodeMk) {
      const singkatan = nama_mk.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 3);
      const acak = Math.floor(100 + Math.random() * 900);
      kodeMk = `MK-${singkatan}-${acak}`;
    }

    // Cek duplikasi kode_mk
    const cekKode = await db.query('SELECT * FROM matakuliah WHERE kode_mk = $1', [kodeMk]);
    if (cekKode.rows.length > 0) {
      return res.status(400).json({ pesan: `Kode Mata Kuliah '${kodeMk}' sudah digunakan.` });
    }

    // Gunakan id dosen pembuat, kecuali jika admin membuatkan untuk dosen lain
    const idDosenVal = (peran === 'admin' && req.body.id_dosen) ? req.body.id_dosen : id;

    const hasil = await db.query(
      `INSERT INTO matakuliah (kode_mk, nama_mk, id_dosen, hari, jam_mulai, jam_selesai, ruangan) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [kodeMk, nama_mk, idDosenVal, hari, jam_mulai, jam_selesai, ruangan]
    );

    res.status(201).json({
      pesan: 'Mata kuliah berhasil ditambahkan!',
      matakuliah: hasil.rows[0]
    });
  } catch (error) {
    console.error('Error saat menambah matakuliah:', error);
    res.status(500).json({ pesan: 'Gagal menambahkan mata kuliah.' });
  }
});

// Menghapus mata kuliah
app.delete('/api/matakuliah/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { peran, id: idUser } = req.pengguna;

  try {
    const cekMk = await db.query('SELECT * FROM matakuliah WHERE id = $1', [id]);
    if (cekMk.rows.length === 0) {
      return res.status(404).json({ pesan: 'Mata kuliah tidak ditemukan.' });
    }

    // Hanya dosen pengampu atau admin yang boleh menghapus
    if (peran !== 'admin' && cekMk.rows[0].id_dosen !== idUser) {
      return res.status(403).json({ pesan: 'Anda tidak berhak menghapus mata kuliah ini.' });
    }

    await db.query('DELETE FROM matakuliah WHERE id = $1', [id]);
    res.json({ pesan: 'Mata kuliah berhasil dihapus.' });
  } catch (error) {
    console.error('Error saat menghapus matakuliah:', error);
    res.status(500).json({ pesan: 'Gagal menghapus mata kuliah.' });
  }
});

// ==========================================
// 3. API AMBIL JADWAL (MAHASISWA)
// ==========================================

// Mahasiswa mendaftar/mengambil jadwal menggunakan Kode MK
app.post('/api/ambil-jadwal', authMiddleware, async (req, res) => {
  const { kode_mk } = req.body;
  const { id, peran } = req.pengguna;

  if (peran !== 'mahasiswa') {
    return res.status(403).json({ pesan: 'Hanya mahasiswa yang dapat mengambil jadwal.' });
  }

  if (!kode_mk) {
    return res.status(400).json({ pesan: 'Kode Mata Kuliah wajib dimasukkan.' });
  }

  try {
    const kodeMkClean = kode_mk.trim().toUpperCase();
    
    // Cari mata kuliah berdasarkan kode_mk
    const mkHasil = await db.query('SELECT * FROM matakuliah WHERE kode_mk = $1', [kodeMkClean]);
    if (mkHasil.rows.length === 0) {
      return res.status(404).json({ pesan: `Mata kuliah dengan kode '${kodeMkClean}' tidak ditemukan.` });
    }

    const matakuliah = mkHasil.rows[0];

    // Cek apakah mahasiswa sudah mengambil kelas ini
    const cekDaftar = await db.query(
      'SELECT * FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2',
      [id, matakuliah.id]
    );

    if (cekDaftar.rows.length > 0) {
      return res.status(400).json({ pesan: 'Anda sudah terdaftar di mata kuliah ini.' });
    }

    // Daftarkan mahasiswa ke mata kuliah
    await db.query(
      'INSERT INTO pendaftaran_mk (id_mahasiswa, id_matakuliah) VALUES ($1, $2)',
      [id, matakuliah.id]
    );

    res.json({
      pesan: `Berhasil mengikuti mata kuliah: ${matakuliah.nama_mk}!`,
      matakuliah: matakuliah
    });
  } catch (error) {
    console.error('Error saat ambil jadwal:', error);
    res.status(500).json({ pesan: 'Gagal mengambil jadwal mata kuliah.' });
  }
});

// Batal mengambil mata kuliah (drop course)
app.post('/api/batal-jadwal', authMiddleware, async (req, res) => {
  const { id_matakuliah } = req.body;
  const { id, peran } = req.pengguna;

  if (peran !== 'mahasiswa') {
    return res.status(403).json({ pesan: 'Hanya mahasiswa yang dapat membatalkan jadwal.' });
  }

  try {
    await db.query(
      'DELETE FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2',
      [id, id_matakuliah]
    );
    res.json({ pesan: 'Berhasil membatalkan pendaftaran kelas ini.' });
  } catch (error) {
    console.error('Error batal jadwal:', error);
    res.status(500).json({ pesan: 'Gagal membatalkan jadwal.' });
  }
});

// ==========================================
// 4. API TEMA UI & MANAGEMENT ADMIN
// ==========================================

// Update tema pilihan pengguna
app.put('/api/pengguna/tema', authMiddleware, async (req, res) => {
  const { tema } = req.body;
  const { id } = req.pengguna;

  if (!tema) {
    return res.status(400).json({ pesan: 'Pilihan tema wajib dikirim.' });
  }

  try {
    await db.query('UPDATE pengguna SET pilihan_tema = $1 WHERE id = $2', [tema, id]);
    res.json({ pesan: 'Tema berhasil diperbarui.', tema: tema });
  } catch (error) {
    console.error('Error update tema:', error);
    res.status(500).json({ pesan: 'Gagal memperbarui tema.' });
  }
});

// Admin mendapatkan daftar semua pengguna
app.get('/api/admin/pengguna', authMiddleware, async (req, res) => {
  if (req.pengguna.peran !== 'admin') {
    return res.status(403).json({ pesan: 'Akses ditolak.' });
  }

  try {
    const hasil = await db.query(
      'SELECT id, no_whatsapp, nama, peran, apakah_diverifikasi, pilihan_tema FROM pengguna ORDER BY peran, nama'
    );
    res.json(hasil.rows);
  } catch (error) {
    console.error('Error admin ambil pengguna:', error);
    res.status(500).json({ pesan: 'Gagal mengambil data pengguna.' });
  }
});

// ==========================================
// 5. API SIMULATOR WHATSAPP
// ==========================================

// Endpoint untuk memantau OTP secara otomatis (Auto-pull OTP)
app.get('/api/simulasi/otp-terbaru', async (req, res) => {
  const { no_whatsapp } = req.query;
  if (!no_whatsapp) {
    return res.status(400).json({ pesan: 'Parameter no_whatsapp diperlukan.' });
  }

  try {
    const otp = await waService.dapatkanOtpTerbaru(no_whatsapp);
    if (otp) {
      return res.json({ sukses: true, otp: otp });
    }
    res.json({ sukses: false, pesan: 'Belum ada OTP baru.' });
  } catch (e) {
    console.error('Error ambil OTP terbaru:', e);
    res.status(500).json({ sukses: false, pesan: 'Gagal mengambil OTP.' });
  }
});

// Mendapatkan pesan WhatsApp terkirim untuk nomor tertentu (HP virtual)
app.get('/api/simulasi/pesan', async (req, res) => {
  const { no_whatsapp } = req.query;
  try {
    const pesan = await waService.dapatkanSemuaPesanSimulasi(no_whatsapp);
    res.json(pesan);
  } catch (e) {
    console.error('Error ambil pesan simulasi:', e);
    res.status(500).json([]);
  }
});

// Mengirim pesan secara manual via simulator (untuk pengetesan admin)
app.post('/api/simulasi/kirim-manual', async (req, res) => {
  const { no_whatsapp, pesan } = req.body;
  if (!no_whatsapp || !pesan) {
    return res.status(400).json({ pesan: 'Nomor WhatsApp dan pesan wajib diisi.' });
  }
  await waService.kirimWhatsApp(no_whatsapp, pesan, 'notifikasi_jadwal');
  res.json({ sukses: true, pesan: 'Pesan simulator berhasil terkirim.' });
});


// ==========================================
// 6. SCHEDULER: PENGINGAT JADWAL 10 MENIT
// ==========================================

/**
 * Memeriksa jadwal kuliah yang akan dimulai 10 menit lagi dan mengirimkan WhatsApp
 */
async function periksaDanKirimPengingat() {
  try {
    const sekarang = new Date();
    
    // Gunakan daftar hari Indonesia
    const daftarHari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const hariIni = daftarHari[sekarang.getDay()];
    
    // Dapatkan jam mulai target (sekarang + 10 menit)
    const sepuluhMenitLagi = new Date(sekarang.getTime() + 10 * 60 * 1000);
    const jam = String(sepuluhMenitLagi.getHours()).padStart(2, '0');
    const menit = String(sepuluhMenitLagi.getMinutes()).padStart(2, '0');
    const jamTarget = `${jam}:${menit}`;

    console.log(`[Scheduler] Memeriksa jadwal hari ${hariIni} yang mulai jam ${jamTarget}...`);

    // 1. Cari mata kuliah hari ini yang dimulai 10 menit lagi
    const mkHasil = await db.query(
      `SELECT mk.*, d.nama AS nama_dosen, d.no_whatsapp AS wa_dosen 
       FROM matakuliah mk 
       JOIN pengguna d ON mk.id_dosen = d.id 
       WHERE mk.hari = $1 AND mk.jam_mulai = $2`,
      [hariIni, jamTarget]
    );

    if (mkHasil.rows.length === 0) {
      return { ditemukan: 0, dikirim: 0 };
    }

    const tglHariIni = sekarang.toISOString().split('T')[0]; // Format 'YYYY-MM-DD'
    let totalDikirim = 0;

    for (const mk of mkHasil.rows) {
      console.log(`[Scheduler] Ditemukan mata kuliah: ${mk.nama_mk} (${mk.kode_mk})`);

      // Cek apakah pengingat untuk kelas ini hari ini sudah dikirim (mencegah double trigger)
      const cekPengingat = await db.query(
        `SELECT * FROM pengingat 
         WHERE id_matakuliah = $1 
           AND tipe = 'notifikasi_jadwal' 
           AND DATE(dikirim_pada) = $2`,
        [mk.id, tglHariIni]
      );

      if (cekPengingat.rows.length > 0) {
        console.log(`[Scheduler] Pengingat untuk '${mk.nama_mk}' hari ini sudah pernah dikirim. Dilewati.`);
        continue;
      }

      // A. Kirim pengingat ke Dosen Pengampu
      await waService.kirimPengingatJadwal(
        mk.wa_dosen,
        mk.nama_dosen,
        mk.nama_mk,
        mk.jam_mulai,
        mk.ruangan,
        mk.kode_mk,
        mk.nama_dosen
      );
      totalDikirim++;

      // B. Ambil semua mahasiswa yang terdaftar di kelas ini
      const mhsHasil = await db.query(
        `SELECT p.nama, p.no_whatsapp 
         FROM pengguna p
         JOIN pendaftaran_mk pm ON p.id = pm.id_mahasiswa
         WHERE pm.id_matakuliah = $1`,
        [mk.id]
      );

      console.log(`[Scheduler] Mengirim pengingat ke ${mhsHasil.rows.length} mahasiswa.`);

      // Kirim pengingat ke setiap mahasiswa
      for (const mhs of mhsHasil.rows) {
        await waService.kirimPengingatJadwal(
          mhs.no_whatsapp,
          mhs.nama,
          mk.nama_mk,
          mk.jam_mulai,
          mk.ruangan,
          mk.kode_mk,
          mk.nama_dosen
        );
        totalDikirim++;
      }
    }
    return { ditemukan: mkHasil.rows.length, dikirim: totalDikirim };
  } catch (error) {
    console.error('Error saat menjalankan scheduler pengingat:', error);
    return { ditemukan: 0, dikirim: 0, error: error.message };
  }
}

// Jalankan pengecekan setiap menit HANYA di mode standalone (bukan Vercel)
// Di Vercel, scheduler dipicu via /api/cron oleh cron-job.org
if (!isServerless && cron) {
  cron.schedule('* * * * *', () => {
    periksaDanKirimPengingat();
  });
}

// ==========================================
// 7. ENDPOINT CRON (UNTUK VERCEL)
// Dipanggil oleh cron-job.org setiap menit untuk memicu scheduler
// ==========================================
app.get('/api/cron/pengingat', async (req, res) => {
  // Proteksi sederhana: butuh secret token supaya tidak bisa di-trigger sembarang
  const token = req.query.token || req.headers['x-cron-token'];
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(403).json({ pesan: 'Akses ditolak. Token cron tidak valid.' });
  }
  try {
    const hasil = await periksaDanKirimPengingat();
    res.json({ sukses: true, waktu: new Date().toISOString(), hasil });
  } catch (error) {
    res.status(500).json({ sukses: false, error: error.message });
  }
});

// Endpoint health check untuk monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isVercel ? 'vercel' : 'standalone',
    database_mode: db.apakahSimulator() ? 'simulator' : 'cloud'
  });
});

// ==========================================
// INISIALISASI SERVER & DATABASE
// ==========================================
// Di Vercel (serverless), kita tidak listen port — biarkan Vercel handle.
// Inisialisasi DB tetap dijalankan saat module load (cold start).
db.inisialisasiDatabase()
  .then(() => {
    if (!isServerless) {
      // Mode standalone (lokal/Render/Glitch): start HTTP server
      app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`Server web Pengingat Jadwal Kuliah berjalan di:`);
        console.log(`👉 http://localhost:${PORT}`);
        console.log(`==================================================`);
      });
    } else {
      console.log('[Vercel/Serverless] Inisialisasi database selesai. Siap melayani request.');
    }
  })
  .catch(err => {
    console.error('Inisialisasi database gagal:', err);
    // Di serverless tidak boleh process.exit, biarkan error ditangani per-request
  });

// Export app supaya bisa dipakai sebagai serverless function (api/index.js)
module.exports = app;
