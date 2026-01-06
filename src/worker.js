require('dotenv').config();
const { Worker } = require('bullmq');
const { Pool } = require('pg');
const IORedis = require('ioredis');

// --- CONFIGURACIÓN DE BASE DE DATOS (POSTGRES) ---
const pool = new Pool({
    user: process.env.DB_USER || 'app_user',        // Usuario que creamos para la App
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'tracking_prod',
    password: process.env.DB_PASS || '1password', // <--- CAMBIA ESTO O USA .ENV
    port: 5432,
});

// --- CONFIGURACIÓN REDIS ---
const connection = new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null
});

console.log("👷 WORKER INICIADO: Esperando datos de GPS...");

// --- PROCESADOR DE TRABAJOS ---
const worker = new Worker('gps-positions', async (job) => {
    const data = job.data;
    const uniqueId = data.device.uniqueId;
    
    // 1. FILTRADO DE DATOS (Limpieza)
    // Aquí quitamos la basura (io1, io2) y dejamos solo lo valioso
    const cleanAttributes = {
        ignition: data.position.attributes.ignition,
        motion: data.position.attributes.motion,
        totalDistance: data.position.attributes.totalDistance,
        battery: data.position.attributes.batteryLevel, // A veces viene, a veces no
        ip: data.position.attributes.ip
    };

    try {
        // 2. BUSCAR O CREAR DISPOSITIVO (Auto-Provisioning)
        // Buscamos el ID interno en NUESTRA base de datos usando el IMEI
        let deviceQuery = await pool.query(
            'SELECT device_id FROM devices WHERE unique_id = $1', 
            [uniqueId]
        );

        let deviceId;

        if (deviceQuery.rows.length > 0) {
            // Ya existe, usamos su ID
            deviceId = deviceQuery.rows[0].device_id;
            
            // Opcional: Actualizar 'last_update' y 'is_online' en la tabla devices
            await pool.query(
                'UPDATE devices SET last_update = NOW(), is_online = $1 WHERE device_id = $2',
                [true, deviceId]
            );

        } else {
            // NO existe: Lo creamos automáticamente (sin Tenant por ahora)
            console.log(`✨ Dispositivo nuevo detectado: ${uniqueId}. Registrando...`);
            const newDevice = await pool.query(
                'INSERT INTO devices (unique_id, name, created_at, last_update) VALUES ($1, $2, NOW(), NOW()) RETURNING device_id',
                [uniqueId, data.device.name || 'Nuevo GPS']
            );
            deviceId = newDevice.rows[0].device_id;
        }

        // 3. INSERTAR LA POSICIÓN (El dato duro)
        const insertQuery = `
            INSERT INTO positions (
                device_id, protocol, server_time, fix_time, valid, 
                latitude, longitude, altitude, speed, course, address, attributes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING position_id
        `;

        const values = [
            deviceId,
            data.position.protocol,         // 'h02'
            data.position.serverTime,       // Hora llegada server
            data.position.fixTime,          // Hora real GPS
            data.position.valid,
            data.position.latitude,
            data.position.longitude,
            data.position.altitude,
            data.position.speed,            // OJO: Traccar lo manda en Nudos. En el frontend convertiremos a KM/H
            data.position.course,
            data.position.address,
            JSON.stringify(cleanAttributes) // Guardamos el JSON limpio
        ];

        await pool.query(insertQuery, values);
        
        console.log(`💾 [GUARDADO] ${uniqueId} | Lat: ${data.position.latitude} | Ignición: ${cleanAttributes.ignition}`);

    } catch (err) {
        console.error(`❌ ERROR procesando ${uniqueId}:`, err.message);
        throw err; // Esto hace que BullMQ reintente si quieres configurar reintentos
    }

}, { connection });

// Manejo de errores del Worker
worker.on('failed', (job, err) => {
    console.error(`💀 Trabajo falló definitivamente: ${job.id} - ${err.message}`);
});