# Arquitectura Técnica: GPS Backend Core

Este documento describe la arquitectura técnica del servicio `gps-backend-core`, encargado de la ingesta, procesamiento y almacenamiento de datos GPS en tiempo real.

## 1. Visión General
`gps-backend-core` es un servicio de alto rendimiento diseñado para recibir datos desde Traccar (via HTTP Forwarding), encolarlos para evitar pérdida de datos en picos de carga, y procesarlos asíncronamente para almacenarlos en la base de datos operativa.

### Stack Tecnológico
-   **Runtime**: Node.js.
-   **Ingesta**: Express.js (Endpoint `/forward`).
-   **Cola de Mensajes**: Redis + BullMQ.
-   **Procesamiento**: Worker asíncrono (BullMQ Worker).
-   **Base de Datos**: PostgreSQL (conexión directa con `pg`, sin ORM pesado para máxima velocidad de escritura).

## 2. Flujo de Datos (Pipeline)

### 2.1. Ingesta (`src/app.js`)
1.  **Recepción**: Traccar envía un JSON con los datos del dispositivo y la posición al endpoint `POST /forward`.
2.  **Validación**: Verifica si el payload contiene datos de posición (`data.position`).
3.  **Encolado (Producer)**:
    -   Inserta un trabajo (`job`) en la cola Redis `gps-positions`.
    -   Responde `200 OK` inmediatamente a Traccar para liberar la conexión HTTP.
    -   **Objetivo**: Alta disponibilidad y baja latencia en la recepción.

### 2.2. Procesamiento (`src/worker.js`)
Un Worker de BullMQ consume los trabajos de la cola `gps-positions` uno a uno (o en paralelo según configuración de concurrencia).

1.  **Limpieza de Datos**:
    -   Extrae atributos clave (`ignition`, `motion`, `battery`, `ip`) y descarta datos basura o irrelevantes del protocolo GPS crudo.
2.  **Auto-Provisioning (Dispositivos)**:
    -   Busca el dispositivo en la tabla `devices` usando su `unique_id` (IMEI).
    -   **Si existe**: Actualiza `last_update` y el estado `is_online`.
    -   **Si NO existe**: Crea automáticamente el dispositivo en la base de datos, asignándole un nombre por defecto.
3.  **Persistencia (Positions)**:
    -   Inserta la posición en la tabla `positions`.
    -   Mapea datos críticos: latitud, longitud, velocidad (nudos a procesar), curso, dirección, y atributos limpios en formato JSON.
    -   Usa `pg` (node-postgres) con consultas SQL crudas (`INSERT INTO ...`) para optimizar el rendimiento de inserción.

## 3. Estructura de Base de Datos (Implícita)

El worker asume la existencia de las siguientes tablas en PostgreSQL:
-   `devices`: Almacena metadatos del GPS (`token`, `name`, `unique_id`, `traccar_id`).
-   `positions`: Histórico de ubicaciones (`device_id`, `lat`, `lon`, `speed`, `attributes` JSONB).

## 4. Configuración (Variables de Entorno)

-   `PORT`: Puerto del servidor de ingesta (Default: 3000).
-   `REDIS_HOST` / `REDIS_PORT`: Conexión a la cola.
-   `DB_HOST` / `DB_USER` / `DB_PASS` / `DB_NAME`: Conexión directa a PostgreSQL.

## 5. Patrones de Diseño Utilizados

-   **Producer-Consumer**: Desacople total entre la recepción de la trama GPS (rápida) y su procesamiento/guardado (lento).
-   **Fail-Fast & Retry**: BullMQ maneja reintentos automáticos si la base de datos está caída momentáneamente.
-   **Raw SQL**: Uso deliberado de SQL nativo en lugar de ORM (Prisma/TypeORM) en el worker para minimizar el overhead en operaciones de escritura intensiva (Write-Heavy).
