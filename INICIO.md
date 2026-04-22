# Stock Mobile — Digital Stone

App de consulta de stock para el celular. Conecta con Tienda Nube y permite
buscar productos (por código de barras o texto) y ver foto, precio y stock.

## Funcionalidad deseada

- App web responsive, optimizada para pantalla de celular
- Input único arriba que acepta:
  - Código de barras (typed o vía scanner)
  - Búsqueda libre por nombre o SKU
- Al encontrar el producto, mostrar:
  - Foto grande del producto
  - Nombre
  - Precio
  - Stock actual
- Si hay múltiples resultados, lista tipo "card" con foto pequeña y stock
- Solo lectura (no modifica nada en Tienda Nube)
- Autenticación: mismo sistema simple de contraseña que la app de PC

## Credenciales de Tienda Nube (reutilizar)

Ya existe una app creada en Partners Portal ("Gestor de Stock Rapido", ID 30189).
Los tokens actuales sirven porque tienen scope `read_products`:

- STORE_ID: `6749925`
- ACCESS_TOKEN: `2b7b342271c8cffd09574aafbf63621556a09fbf`
- USER_AGENT: `Gestor de Stock Rapido (info@digitalstone.com.ar)`

Endpoint base de la API: `https://api.tiendanube.com/v1/{STORE_ID}`

Header de autenticación:
```
Authentication: bearer {ACCESS_TOKEN}
User-Agent: {USER_AGENT}
```

## Decisiones a tomar en el nuevo chat

1. **Uso:** ¿solo dentro del local con WiFi, o también fuera con datos móviles?
   (define si alcanza con Flask local o hay que desplegar en un server)
2. **Scanner de código de barras:** ¿via cámara del celular, scanner USB, o
   dejar solo el input manual por ahora?
3. **Ícono en el home del celular (PWA):** ¿lo queremos desde el arranque o más adelante?
4. **Contraseña de ingreso:** definir cuál.

## Relación con el proyecto de PC

El proyecto de PC está en `/Users/andresdlp/Desktop/CLAUDE/juego/` y es
independiente. Comparte la misma cuenta de Tienda Nube y mismo token pero
nada más. Funcionan por separado.

## Logo

Se puede reutilizar `logo.png` que ya está en la carpeta `juego/static/`.
