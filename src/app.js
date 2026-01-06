require('dotenv').config();
const express = require('express');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// --- CONFIGURACIÓN ---
const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// --- CONEXIÓN A REDIS (LA COLA) ---
// Usamos una conexión para BullMQ
const connection = new IORedis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null 
});

// Creamos la cola llamada 'gps-positions'
const gpsQueue = new Queue('gps-positions', { connection });

// --- MIDDLEWARE ---
// Traccar envía JSON, así que necesitamos que Express lo entienda
app.use(express.json());

// --- RUTA PRINCIPAL (EL FORWARD) ---
// --- RUTA PRINCIPAL (EL FORWARD PRO) ---
app.post('/forward', async (req, res) => {
    try {
        const data = req.body; // Aquí llega el JSON ya parseado

        console.log('📦 [POST JSON] Recibido paquete PRO:');
        console.dir(data, { depth: null, colors: true }); // Imprime todo el árbol de datos

        // Si trae posición, encolar a Redis
        if (data.position) {
            await gpsQueue.add('process-gps', data, {
                removeOnComplete: 1000,
                removeOnFail: 5000
            });
            console.log('✅ Enviado a la Cola Redis');
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(200).send('Error');
    }
});

// --- RUTA DEBUG PARA GET (El Parche) ---
app.get('/forward', (req, res) => {
    console.log('⚠️ [GET REQUEST] Traccar envió datos por URL:');
    console.log(req.query); // Aquí veremos la data si viene por GET
    res.status(200).send('OK');
});

// --- ARRANCAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 API de Ingesta corriendo en el puerto ${PORT}`);
    console.log(`🔗 Conectado a Redis en ${REDIS_HOST}:${REDIS_PORT}`);
});

// --- ESPÍA DE RUTAS (DEBUG) ---
app.use((req, res, next) => {
    console.log(`[DEBUG] Traccar está pidiendo: ${req.method} ${req.url}`);
    next();
});