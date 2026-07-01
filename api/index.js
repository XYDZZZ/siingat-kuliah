// Vercel Serverless Function Entry Point
// -----------------------------------------------
// Vercel akan otomatis mengeksekusi file ini untuk setiap request yang masuk
// ke /api/* berdasarkan konfigurasi rewrites di vercel.json.
// Kita cukup export Express app dari server.js.

const app = require('../server.js');

// Vercel @vercel/node handler akan otomatis mendeteksi Express app
// dan membungkusnya menjadi serverless function.
module.exports = app;
