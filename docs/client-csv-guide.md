# Bulk product upload: CSV guide

This guide explains how to add or update many products at once with a CSV file. You need an admin account.

## Before you start

- The file must be a CSV file (`.csv`), saved as UTF-8.
- The file must be 2 MB or smaller.
- A file can contain at most 500 product rows. The header row does not count.
- Use one row per product.
- Product images are not part of the CSV. See "Images" below.

## The four steps

1. **Prepare the file.** Start from `docs/products-template.csv`, keep the header row, and add one row per product. Delete the example row before importing.
2. **Choose it on the bulk upload page.** In the admin area, open **Products**, then **Bulk upload**, click **Choose CSV file**, and select your file. The upload field is named `file`.
3. **Preview.** Click **Preview**. This checks the file without saving anything. If rows have errors, fix them and preview again.
4. **Import.** When the preview shows no errors, click **Import products**. The page shows the result.

## Columns

The header row must use these exact column names. Order does not matter to the importer, but the template uses this order.

| Column | Required? | Allowed values | Example |
| --- | --- | --- | --- |
| `id` | Optional | Leave blank to create a new product. To update an existing product, paste its product ID (up to 64 characters). | (leave blank) |
| `name` | Required | 1 to 120 characters. | iPhone 15 Pro |
| `brand` | Required | 1 to 60 characters. | Apple |
| `category` | Required | `IPHONE`, `SAMSUNG` or `LAPTOP`. Letter case is ignored. | IPHONE |
| `description` | Optional | Up to 1000 characters. | Titanium phone with a 48MP camera. |
| `basePrice` | Required | A number greater than 0 with at most 2 decimal places and at most 8 digits before the decimal point. No currency symbol and no thousands separators. | 4999.00 |
| `isActive` | Optional | `true` or `false`. Letter case is ignored. If blank, the product is active. | true |
| `colors` | Required | `Name:stock\|Name:stock` (see "Colours and stock"). Between 1 and 10 colours. | `Midnight:12\|Blue:8` |

### Spec columns (optional)

These columns are optional. Use only the columns that apply to the product's category; leave the rest blank. If you fill a spec column, the value must match the rules below.

| Column | Applies to | Allowed values | Example |
| --- | --- | --- | --- |
| `storage` | iPhone, Samsung, Laptop | iPhone and Samsung: `128GB`, `256GB`, `512GB`, `1TB`. Laptop: `256GB`, `512GB`, `1TB`, `2TB`. | 256GB |
| `ram` | Samsung, Laptop | Samsung: `4GB`, `6GB`, `8GB`, `12GB`, `16GB`. Laptop: `4GB`, `8GB`, `12GB`, `16GB`, `24GB`, `32GB`, `64GB`. | 8GB |
| `chip` | iPhone | Text up to 60 characters. | A17 Pro |
| `camera` | iPhone, Samsung | Text up to 120 characters. | 48MP main camera |
| `screenSize` | iPhone, Samsung, Laptop | Text up to 20 characters. | 6.1 inches |
| `battery` | iPhone, Samsung | Text up to 60 characters. | Up to 23 hours video playback |
| `processor` | Laptop | Text up to 80 characters. | Intel Core i7 |
| `graphics` | Laptop | Text up to 80 characters. | NVIDIA RTX 4060 |
| `batteryLife` | Laptop | Text up to 40 characters. | Up to 10 hours |
| `colour` | iPhone, Samsung, Laptop | Text up to 40 characters. The colour shown in the specifications, for example `Midnight`. It does not have to match a name in the `colors` column. For a product with several colours, use the main colour or leave it blank. | Midnight |

## Category values

The importer accepts these category values:

- `IPHONE`
- `SAMSUNG`
- `LAPTOP`

The value is uppercased before it is checked, so `iPhone`, `Samsung` and `Laptop` also work. No other category is accepted.

## Colours and stock

Put all colours in the single `colors` column. Use this format:

`Name:stock|Name:stock`

- Separate each colour with a vertical bar (`|`).
- Put a colon (`:`) between the colour name and its stock.
- Stock is a whole number of 0 or more. Do not use decimals or negative numbers.
- Each colour name can be up to 40 characters.
- Duplicate colour names (ignoring letter case) are rejected.
- A product can have 1 to 10 colours.

Examples:

- `Midnight:12`
- `Midnight:12|Blue:8`

For an existing product, the stock number is the new total stock for that colour, not an amount to add.

To update an existing product, paste its ID in the `id` column and keep every required column filled in, including name, brand, category, basePrice and colors. A row with a missing required column is rejected even when the product already exists.

## Images

Product images are not in the CSV. After the import, open each product's edit page and add its images there. You can add up to 6 images per product.

## Example row

**Example phone - delete before import**

```csv
id,name,brand,category,description,basePrice,isActive,colors,storage,ram,chip,camera,screenSize,battery,processor,graphics,batteryLife,colour
,iPhone 15 Pro,Apple,IPHONE,Titanium phone with a 48MP camera.,4999.00,true,Midnight:12|Blue:8,256GB,,A17 Pro,48MP main camera,6.1 inches,Up to 23 hours video playback,,,,Midnight
```

Delete the example row before importing. The first field is empty because `id` is blank for a new product.
