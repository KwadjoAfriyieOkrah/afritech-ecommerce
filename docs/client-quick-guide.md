# Adding products in bulk

1. In the admin, open **Bulk upload** and click **Download template**.
2. Open the file in Google Sheets or Excel. Keep the column names in the first row exactly as they are.
3. Type one product per row, under the column names.
   - **category**: IPHONE, SAMSUNG or LAPTOP.
   - **basePrice**: a plain number, for example 4999.00. No currency symbol or commas.
   - **colors**: colour name, colon, stock, with bars between colours. For example: Midnight:12|Blue:8
   - **Leave `id` empty** for a new product.
4. Save or download the sheet as a CSV file.
5. On the **Bulk upload** page, choose the file and click **Preview**.
6. If the preview shows any red errors, fix those rows in the sheet and upload again. Import is enabled only when the preview has no errors.
7. Click **Import**.

**Images** are not part of the spreadsheet. After the import, open each product's edit page and add its images there (up to 6 per product).

**Limits:** 500 rows and 2 MB per file.

Delete any test rows before you import the full list.
