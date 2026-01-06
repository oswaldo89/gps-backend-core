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
app.post('/forward', async (req, res) => {
    try {
        const data = req.body;

        // 1. Validación rápida (Security Layer)
        // Si no trae deviceId o uniqueId, es basura.
        if (!data.device || !data.position) {
            console.warn('[REJECT] Datos incompletos recibidos:', data);
            return res.status(400).send('Bad Request');
        }

        // 2. Logging (Para que veas en consola qué llega)
        console.log(`[INGEST] 📡 GPS: ${data.device.name} (${data.device.uniqueId}) | Lat: ${data.position.latitude}`);

        // 3. ENCOLAMIENTO (Lo importante)
        // Metemos el trabajo a Redis. Le ponemos un nombre ('process-gps') y los datos.
        // removeOnComplete: true ayuda a que Redis no se llene de basura vieja.
        await gpsQueue.add('process-gps', data, {
            removeOnComplete: 1000, // Guardar solo los últimos 1000 éxitos
            removeOnFail: 5000      // Guardar errores para auditoría
        });

        // 4. Respuesta Inmediata a Traccar
        // Respondemos en < 10ms para liberar la conexión
        res.status(200).send('OK');

    } catch (error) {
        console.error('[ERROR] Fallo en API Ingesta:', error);
        // Aunque falle la cola, respondemos 200 a Traccar para que no reintente infinitamente
        // (O puedes poner 500 si quieres que reintente)
        res.status(200).send('Error handled');
    }
});

// --- ARRANCAR SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 API de Ingesta corriendo en el puerto ${PORT}`);
    console.log(`🔗 Conectado a Redis en ${REDIS_HOST}:${REDIS_PORT}`);
});