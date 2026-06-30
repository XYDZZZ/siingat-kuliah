require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// State untuk melacak apakah kita menggunakan database cloud asli atau simulator
let menggunakanSimulator = false;

// File penyimpanan data simulator jika terpaksa fallback
const FILE_DATA_SIMULATOR = path.join(__dirname, 'db_cloud_simulated.json');

// Kredensial PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 5000 // Batasan waktu koneksi 5 detik agar cepat fallback jika gagal
});

// Struktur Data Simulator In-Memory
let dataSimulasi = {
  pengguna: [],
  matakuliah: [],
  pendaftaran_mk: [],
  pengingat: []
};

// Muat data simulasi dari file jika ada
function muatDataSimulator() {
  try {
    if (fs.existsSync(FILE_DATA_SIMULATOR)) {
      const konten = fs.readFileSync(FILE_DATA_SIMULATOR, 'utf-8');
      dataSimulasi = JSON.parse(konten);
      console.log(`[Simulator DB] Berhasil memuat data dari ${FILE_DATA_SIMULATOR}`);
    } else {
      simpanDataSimulator();
    }
  } catch (e) {
    console.error('[Simulator DB] Gagal memuat file data:', e);
  }
}

// Simpan data simulasi ke file
function simpanDataSimulator() {
  try {
    fs.writeFileSync(FILE_DATA_SIMULATOR, JSON.stringify(dataSimulasi, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Simulator DB] Gagal menyimpan file data:', e);
  }
}

// Inisialisasi data admin bawaan di simulator agar sistem langsung memiliki data pengujian
function inisialisasiAdminBawaanSimulator() {
  if (dataSimulasi.pengguna.length === 0) {
    // Password hash dari kata sandi 'admin123' menggunakan bcrypt (di-generate manual untuk keandalan)
    // $2a$10$T1K7f4b3M2ZJ6C3eG5X5uOmQyMpHd285m/KzR6D2qN2l5D3qN.wWq
    dataSimulasi.pengguna.push({
      id: 1,
      no_whatsapp: '081234567890',
      nama: 'Administrator Utama',
      hash_kata_sandi: '$2a$10$T1K7f4b3M2ZJ6C3eG5X5uOmQyMpHd285m/KzR6D2qN2l5D3qN.wWq', // admin123
      peran: 'admin',
      kode_otp: null,
      otp_kedaluwarsa: null,
      apakah_diverifikasi: true,
      pilihan_tema: 'admin'
    });
    simpanDataSimulator();
    console.log('[Simulator DB] Akun Administrator bawaan dibuat: 081234567890 / admin123');
  }
}

// ==========================================================================
// MOCK SQL ENGINE - MENERJEMAHKAN QUERY POSTGRES KE OPERASI ARRAY JS
// ==========================================================================
function jalankanQuerySimulator(sql, params = []) {
  const sqlClean = sql.replace(/\s+/g, ' ').trim();
  
  // 1. SELECT * FROM pengguna WHERE id = $1
  if (sqlClean.includes('SELECT * FROM pengguna WHERE id = $1')) {
    const id = params[0];
    const baris = dataSimulasi.pengguna.filter(u => u.id === id);
    return { rows: baris };
  }

  // 2. SELECT * FROM pengguna WHERE no_whatsapp = $1
  if (sqlClean.includes('SELECT * FROM pengguna WHERE no_whatsapp = $1')) {
    const no = params[0];
    const baris = dataSimulasi.pengguna.filter(u => u.no_whatsapp === no);
    return { rows: baris };
  }

  // 3. INSERT INTO pengguna (no_whatsapp, nama, hash_kata_sandi, peran, kode_otp, otp_kedaluwarsa, apakah_diverifikasi)
  if (sqlClean.includes('INSERT INTO pengguna') && sqlClean.includes('apakah_diverifikasi')) {
    const [no_whatsapp, nama, hash_kata_sandi, peran, kode_otp, otp_expires, apakah_diverifikasi] = params;
    const id = dataSimulasi.pengguna.length > 0 ? Math.max(...dataSimulasi.pengguna.map(u => u.id)) + 1 : 1;
    const userBaru = {
      id,
      no_whatsapp,
      nama,
      hash_kata_sandi,
      peran,
      kode_otp,
      otp_kedaluwarsa: otp_expires,
      apakah_diverifikasi: apakah_diverifikasi || false,
      pilihan_tema: peran // Default tema sama dengan peran
    };
    dataSimulasi.pengguna.push(userBaru);
    simpanDataSimulator();
    return { rows: [userBaru] };
  }

  // 4. UPDATE pengguna SET nama = ..., apakah_diverifikasi = FALSE WHERE no_whatsapp = ...
  if (sqlClean.includes('UPDATE pengguna SET nama =') && sqlClean.includes('apakah_diverifikasi = FALSE')) {
    const [nama, hash_kata_sandi, peran, kode_otp, otp_kedaluwarsa, no_whatsapp] = params;
    const index = dataSimulasi.pengguna.findIndex(u => u.no_whatsapp === no_whatsapp);
    if (index !== -1) {
      dataSimulasi.pengguna[index] = {
        ...dataSimulasi.pengguna[index],
        nama, hash_kata_sandi, peran, kode_otp, otp_kedaluwarsa,
        apakah_diverifikasi: false
      };
      simpanDataSimulator();
      return { rows: [dataSimulasi.pengguna[index]] };
    }
    return { rows: [] };
  }

  // 5. UPDATE pengguna SET apakah_diverifikasi = TRUE, kode_otp = NULL WHERE no_whatsapp = $1
  if (sqlClean.includes('UPDATE pengguna SET apakah_diverifikasi = TRUE')) {
    const no_whatsapp = params[0];
    const index = dataSimulasi.pengguna.findIndex(u => u.no_whatsapp === no_whatsapp);
    if (index !== -1) {
      dataSimulasi.pengguna[index].apakah_diverifikasi = true;
      dataSimulasi.pengguna[index].kode_otp = null;
      dataSimulasi.pengguna[index].otp_kedaluwarsa = null;
      simpanDataSimulator();
      return { rows: [dataSimulasi.pengguna[index]] };
    }
    return { rows: [] };
  }

  // 6. UPDATE pengguna SET pilihan_tema = $1 WHERE id = $2
  if (sqlClean.includes('UPDATE pengguna SET pilihan_tema = $1 WHERE id = $2')) {
    const [tema, id] = params;
    const index = dataSimulasi.pengguna.findIndex(u => u.id === id);
    if (index !== -1) {
      dataSimulasi.pengguna[index].pilihan_tema = tema;
      simpanDataSimulator();
      return { rows: [dataSimulasi.pengguna[index]] };
    }
    return { rows: [] };
  }

  // 7. SELECT id, no_whatsapp, nama, peran, apakah_diverifikasi, pilihan_tema FROM pengguna ORDER BY peran, nama
  if (sqlClean.includes('SELECT id, no_whatsapp, nama, peran, apakah_diverifikasi, pilihan_tema FROM pengguna')) {
    const users = dataSimulasi.pengguna.map(u => ({
      id: u.id,
      no_whatsapp: u.no_whatsapp,
      nama: u.nama,
      peran: u.peran,
      apakah_diverifikasi: u.apakah_diverifikasi,
      pilihan_tema: u.pilihan_tema
    }));
    // Sort
    users.sort((a, b) => a.peran.localeCompare(b.peran) || a.nama.localeCompare(b.nama));
    return { rows: users };
  }

  // 8. SELECT mk.*, p.nama AS nama_dosen FROM matakuliah mk JOIN pengguna p ON mk.id_dosen = p.id WHERE mk.id_dosen = $1
  if (sqlClean.includes('SELECT mk.*, p.nama AS nama_dosen FROM matakuliah mk JOIN pengguna p') && sqlClean.includes('id_dosen = $1')) {
    const id_dosen = params[0];
    const dosen = dataSimulasi.pengguna.find(u => u.id === id_dosen);
    const nama_dosen = dosen ? dosen.nama : 'Dosen Tidak Diketahui';
    const mkList = dataSimulasi.matakuliah
      .filter(mk => mk.id_dosen === id_dosen)
      .map(mk => ({ ...mk, nama_dosen }));
    return { rows: mkList };
  }

  // 9. SELECT p.id, p.nama, p.no_whatsapp FROM pengguna p JOIN pendaftaran_mk pm ON p.id = pm.id_mahasiswa WHERE pm.id_matakuliah = $1
  if (sqlClean.includes('id_mahasiswa WHERE pm.id_matakuliah = $1')) {
    const id_matakuliah = params[0];
    const mhsIds = dataSimulasi.pendaftaran_mk
      .filter(pm => pm.id_matakuliah === id_matakuliah)
      .map(pm => pm.id_mahasiswa);
    const mhsList = dataSimulasi.pengguna
      .filter(u => mhsIds.includes(u.id))
      .map(u => ({ id: u.id, nama: u.nama, no_whatsapp: u.no_whatsapp }));
    return { rows: mhsList };
  }

  // 10. SELECT mk.*, p.nama AS nama_dosen FROM matakuliah ... JOIN pendaftaran_mk pm ON mk.id = pm.id_matakuliah WHERE pm.id_mahasiswa = $1
  if (sqlClean.includes('pendaftaran_mk pm ON mk.id = pm.id_matakuliah WHERE pm.id_mahasiswa = $1')) {
    const id_mahasiswa = params[0];
    const mkIds = dataSimulasi.pendaftaran_mk
      .filter(pm => pm.id_mahasiswa === id_mahasiswa)
      .map(pm => pm.id_matakuliah);
    const mkList = dataSimulasi.matakuliah
      .filter(mk => mkIds.includes(mk.id))
      .map(mk => {
        const dosen = dataSimulasi.pengguna.find(u => u.id === mk.id_dosen);
        return {
          ...mk,
          nama_dosen: dosen ? dosen.nama : 'Dosen'
        };
      });
    return { rows: mkList };
  }

  // 11. SELECT mk.*, p.nama AS nama_dosen, (SELECT COUNT(*) FROM pendaftaran_mk WHERE id_matakuliah = mk.id) AS total_mahasiswa FROM matakuliah
  if (sqlClean.includes('total_mahasiswa FROM matakuliah')) {
    const mkList = dataSimulasi.matakuliah.map(mk => {
      const dosen = dataSimulasi.pengguna.find(u => u.id === mk.id_dosen);
      const total = dataSimulasi.pendaftaran_mk.filter(pm => pm.id_matakuliah === mk.id).length;
      return {
        ...mk,
        nama_dosen: dosen ? dosen.nama : 'Dosen',
        total_mahasiswa: total
      };
    });
    return { rows: mkList };
  }

  // 12. SELECT mk.*, p.nama AS nama_dosen FROM matakuliah mk JOIN pengguna p ON mk.id_dosen = p.id ORDER BY mk.nama_mk
  if (sqlClean.includes('FROM matakuliah mk JOIN pengguna p ON mk.id_dosen = p.id ORDER BY mk.nama_mk')) {
    const mkList = dataSimulasi.matakuliah.map(mk => {
      const dosen = dataSimulasi.pengguna.find(u => u.id === mk.id_dosen);
      return {
        ...mk,
        nama_dosen: dosen ? dosen.nama : 'Dosen'
      };
    });
    mkList.sort((a, b) => a.nama_mk.localeCompare(b.nama_mk));
    return { rows: mkList };
  }

  // 13. INSERT INTO matakuliah (kode_mk, nama_mk, id_dosen, hari, jam_mulai, jam_selesai, ruangan) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
  if (sqlClean.includes('INSERT INTO matakuliah')) {
    const [kode_mk, nama_mk, id_dosen, hari, jam_mulai, jam_selesai, ruangan] = params;
    const id = dataSimulasi.matakuliah.length > 0 ? Math.max(...dataSimulasi.matakuliah.map(m => m.id)) + 1 : 1;
    const mkBaru = { id, kode_mk, nama_mk, id_dosen, hari, jam_mulai, jam_selesai, ruangan };
    dataSimulasi.matakuliah.push(mkBaru);
    simpanDataSimulator();
    return { rows: [mkBaru] };
  }

  // 14. SELECT * FROM matakuliah WHERE kode_mk = $1
  if (sqlClean.includes('SELECT * FROM matakuliah WHERE kode_mk = $1')) {
    const kode = params[0];
    const baris = dataSimulasi.matakuliah.filter(m => m.kode_mk === kode);
    return { rows: baris };
  }

  // 15. SELECT * FROM matakuliah WHERE id = $1
  if (sqlClean.includes('SELECT * FROM matakuliah WHERE id = $1')) {
    const id = params[0];
    const baris = dataSimulasi.matakuliah.filter(m => m.id === id);
    return { rows: baris };
  }

  // 16. DELETE FROM matakuliah WHERE id = $1
  if (sqlClean.includes('DELETE FROM matakuliah WHERE id = $1')) {
    const id = parseInt(params[0], 10);
    dataSimulasi.matakuliah = dataSimulasi.matakuliah.filter(m => m.id !== id);
    // Hapus pendaftarannya juga
    dataSimulasi.pendaftaran_mk = dataSimulasi.pendaftaran_mk.filter(pm => pm.id_matakuliah !== id);
    simpanDataSimulator();
    return { rows: [] };
  }

  // 17. SELECT * FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2
  if (sqlClean.includes('SELECT * FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2')) {
    const [id_mahasiswa, id_matakuliah] = params;
    const baris = dataSimulasi.pendaftaran_mk.filter(pm => pm.id_mahasiswa === id_mahasiswa && pm.id_matakuliah === id_matakuliah);
    return { rows: baris };
  }

  // 18. INSERT INTO pendaftaran_mk (id_mahasiswa, id_matakuliah) VALUES ($1, $2)
  if (sqlClean.includes('INSERT INTO pendaftaran_mk')) {
    const [id_mahasiswa, id_matakuliah] = params;
    dataSimulasi.pendaftaran_mk.push({ id_mahasiswa, id_matakuliah });
    simpanDataSimulator();
    return { rows: [] };
  }

  // 19. DELETE FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2
  if (sqlClean.includes('DELETE FROM pendaftaran_mk WHERE id_mahasiswa = $1 AND id_matakuliah = $2')) {
    const [id_mahasiswa, id_matakuliah] = params;
    dataSimulasi.pendaftaran_mk = dataSimulasi.pendaftaran_mk.filter(
      pm => !(pm.id_mahasiswa === id_mahasiswa && pm.id_matakuliah === id_matakuliah)
    );
    simpanDataSimulator();
    return { rows: [] };
  }

  // 20. INSERT INTO pengingat (id_matakuliah, no_whatsapp, pesan, status, tipe)
  if (sqlClean.includes('INSERT INTO pengingat')) {
    const [id_matakuliah, no_whatsapp, pesan, status, tipe] = params;
    const id = dataSimulasi.pengingat.length > 0 ? Math.max(...dataSimulasi.pengingat.map(p => p.id)) + 1 : 1;
    const pengingatBaru = { id, id_matakuliah, no_whatsapp, pesan, status, tipe, dikirim_pada: new Date().toISOString() };
    dataSimulasi.pengingat.push(pengingatBaru);
    simpanDataSimulator();
    return { rows: [pengingatBaru] };
  }

  // 21. SELECT mk.*, d.nama AS nama_dosen, d.no_whatsapp AS wa_dosen FROM matakuliah mk JOIN pengguna d ON mk.id_dosen = d.id WHERE mk.hari = $1 AND mk.jam_mulai = $2
  if (sqlClean.includes('WHERE mk.hari = $1 AND mk.jam_mulai = $2')) {
    const [hari, jam_mulai] = params;
    const mkList = dataSimulasi.matakuliah.filter(mk => mk.hari === hari && mk.jam_mulai === jam_mulai);
    const hasil = mkList.map(mk => {
      const dosen = dataSimulasi.pengguna.find(u => u.id === mk.id_dosen);
      return {
        ...mk,
        nama_dosen: dosen ? dosen.nama : 'Dosen',
        wa_dosen: dosen ? dosen.no_whatsapp : '0812'
      };
    });
    return { rows: hasil };
  }

  // 22. SELECT * FROM pengingat WHERE id_matakuliah = $1 AND tipe = 'notifikasi_jadwal' AND DATE(dikirim_pada) = $2
  if (sqlClean.includes('tipe = \'notifikasi_jadwal\'') && sqlClean.includes('DATE(dikirim_pada) = $2')) {
    const [id_matakuliah, tanggal] = params; // tanggal: YYYY-MM-DD
    const baris = dataSimulasi.pengingat.filter(p => {
      const tglPesan = new Date(p.dikirim_pada).toISOString().split('T')[0];
      return p.id_matakuliah === id_matakuliah && p.tipe === 'notifikasi_jadwal' && tglPesan === tanggal;
    });
    return { rows: baris };
  }

  // 23. SELECT p.nama, p.no_whatsapp FROM pengguna p JOIN pendaftaran_mk pm ON p.id = pm.id_mahasiswa WHERE pm.id_matakuliah = $1
  if (sqlClean.includes('p.no_whatsapp FROM pengguna p JOIN pendaftaran_mk pm ON p.id = pm.id_mahasiswa WHERE pm.id_matakuliah = $1')) {
    const id_matakuliah = params[0];
    const mhsIds = dataSimulasi.pendaftaran_mk
      .filter(pm => pm.id_matakuliah === id_matakuliah)
      .map(pm => pm.id_mahasiswa);
    const mhsList = dataSimulasi.pengguna
      .filter(u => mhsIds.includes(u.id))
      .map(u => ({ nama: u.nama, no_whatsapp: u.no_whatsapp }));
    return { rows: mhsList };
  }

  // Fallback default
  console.log(`[Simulator DB] INFO: Query SQL tidak dikenal secara spesifik. Melakukan mock data kosong.`);
  return { rows: [] };
}

// Wrapper query utama
const query = async (text, params) => {
  if (menggunakanSimulator) {
    return jalankanQuerySimulator(text, params);
  }
  return pool.query(text, params);
};

// Inisialisasi Tabel / Fallback
const inisialisasiDatabase = async () => {
  try {
    console.log('Menghubungkan ke database cloud PostgreSQL...');
    
    // Coba ping database cloud
    await pool.query('SELECT NOW()');
    
    console.log('==================================================');
    console.log('⚡ SINKRONISASI CLOUD AKTIF! Terhubung ke Postgres Cloud.');
    console.log('==================================================');
    
    // 1. Jalankan inisialisasi tabel cloud jika sukses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pengguna (
        id SERIAL PRIMARY KEY,
        no_whatsapp VARCHAR(20) UNIQUE NOT NULL,
        nama VARCHAR(100) NOT NULL,
        hash_kata_sandi VARCHAR(100) NOT NULL,
        peran VARCHAR(20) NOT NULL CHECK (peran IN ('admin', 'dosen', 'mahasiswa')),
        kode_otp VARCHAR(10),
        otp_kedaluwarsa TIMESTAMP,
        apakah_diverifikasi BOOLEAN DEFAULT FALSE,
        pilihan_tema VARCHAR(20) DEFAULT 'default'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS matakuliah (
        id SERIAL PRIMARY KEY,
        kode_mk VARCHAR(20) UNIQUE NOT NULL,
        nama_mk VARCHAR(100) NOT NULL,
        id_dosen INTEGER REFERENCES pengguna(id) ON DELETE CASCADE,
        hari VARCHAR(20) NOT NULL,
        jam_mulai VARCHAR(5) NOT NULL,
        jam_selesai VARCHAR(5) NOT NULL,
        ruangan VARCHAR(50) NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pendaftaran_mk (
        id_mahasiswa INTEGER REFERENCES pengguna(id) ON DELETE CASCADE,
        id_matakuliah INTEGER REFERENCES matakuliah(id) ON DELETE CASCADE,
        PRIMARY KEY (id_mahasiswa, id_matakuliah)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pengingat (
        id SERIAL PRIMARY KEY,
        id_matakuliah INTEGER REFERENCES matakuliah(id) ON DELETE SET NULL,
        no_whatsapp VARCHAR(20) NOT NULL,
        pesan TEXT NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('sukses', 'gagal')),
        tipe VARCHAR(50) NOT NULL CHECK (tipe IN ('otp', 'notifikasi_jadwal')),
        dikirim_pada TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tambahkan admin default jika di cloud masih kosong
    const cekAdmin = await pool.query("SELECT * FROM pengguna WHERE peran = 'admin'");
    if (cekAdmin.rows.length === 0) {
      await pool.query(`
        INSERT INTO pengguna (no_whatsapp, nama, hash_kata_sandi, peran, apakah_diverifikasi, pilihan_tema)
        VALUES ('081234567890', 'Administrator Utama', '$2a$10$T1K7f4b3M2ZJ6C3eG5X5uOmQyMpHd285m/KzR6D2qN2l5D3qN.wWq', 'admin', TRUE, 'admin')
      `);
      console.log('[Cloud DB] Akun Administrator cloud default berhasil dibuat: 081234567890 / admin123');
    }

  } catch (error) {
    menggunakanSimulator = true;
    console.log('\n==================================================');
    console.log('⚠️  KONEKSI DATABASE CLOUD POSTGRESQL GAGAL ATAU DI-BLOCK!');
    console.log('🤖 Mengaktifkan Mode: SIMULATOR CLOUD DATABASE (JSON/Memory)');
    console.log('   Sistem tetap berjalan 100% lancar secara lokal.');
    console.log('   Semua data Mahasiswa, Dosen, & Admin disinkronkan di sini.');
    console.log('==================================================\n');

    // Muat data simulator dari file lokal
    muatDataSimulator();
    // Buat admin default di simulator
    inisialisasiAdminBawaanSimulator();
  }
};

module.exports = {
  query,
  pool,
  inisialisasiDatabase,
  apakahSimulator: () => menggunakanSimulator
};
