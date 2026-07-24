# Filatelia Peruana - Plataforma Digital Premium

Este proyecto es una plataforma filatélica de alta gama que combina un **Catálogo Visual (estilo álbum)** con una **Tienda Online especializada**. Diseñado para coleccionistas que buscan excelencia visual e integridad histórica.

## 🚀 Tecnologías (Stack "God Tier")
- **Framework**: Next.js 15 (App Router)
- **Estilos**: Tailwind CSS 4.0
- **Base de Datos**: PostgreSQL (Supabase)
- **ORM**: Prisma 7
- **Almacenamiento de Imágenes**: Cloudflare R2
- **Animaciones**: Framer Motion
- **Estado**: Zustand + React Query

## 📂 Estructura del Proyecto
- `/src/app/(public)`: Catálogo, Tienda y vistas para el usuario final.
- `/src/app/(admin)`: Panel de gestión privada.
- `/src/services`: Lógica de negocio (Catálogo, Tienda, Importación).
- `/src/components`: Componentes reutilizables con el diseño "Verde Musgo".
- `/prisma`: Esquema de base de datos y scripts de seed.

## 🛠️ Instalación Local
1. Clonar el repositorio.
2. Instalar dependencias:
   ```bash
   npm install
   ```
3. Configurar el archivo `.env` (ver `.env.example`).
4. Generar el cliente de base de datos:
   ```bash
   npx prisma generate
   ```
5. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

## 📊 Importación Masiva
El sistema incluye un servicio de importación desde Excel. Puedes encontrar la estructura requerida en el archivo `plantilla_importacion_filatelia.xlsx` ubicado en la raíz.

## 🎨 Identidad Visual
- **Primario**: Verde Musgo (#556B2F)
- **Fondo**: Black / Zinc 950
- **Tipografía**: Playfair Display (Serif) e Inter (Sans)

---
Desarrollado para **filateliaperuana.com**
