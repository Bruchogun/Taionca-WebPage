import { compose } from "compose-middleware";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { code, description, brand , cost, price, storage, measure, min_stock, mid_stock, max_stock, supplier, manufacture } = req.body;
        const {rows: spendable_items} = await query(
           `
            WITH new_spendable_product as (
                INSERT INTO public.spendable_products
                    (code, description, id_measure, min_stock, mid_stock, max_stock, manufacture)
                    VALUES ($1::character varying, $2::character varying, $7::integer, $8::numeric, $9::numeric, $10::numeric, $12::character varying)
                    ON CONFLICT(code) DO NOTHING
                    RETURNING id_spendable_product
            ), new_brand as (
                INSERT INTO public.brands
                    (name)
                    VALUES ($3::character varying)
                    ON CONFLICT(name) DO NOTHING
                    RETURNING id_brand
            ), new_spendable_item as (
                INSERT INTO public.spendable_items
                    ( id_brand, id_spendable_product, cost, price, id_supplier)
                    SELECT
                        brand.id_brand,
                        spendable_product.id_spendable_product,
                        $4::numeric,
                        $5::numeric,
                        $11::integer
                    FROM
                        (
                            SELECT COALESCE(
                                (SELECT id_spendable_product FROM new_spendable_product),
                                (SELECT id_spendable_product FROM spendable_products WHERE code = $1)
                            ) AS id_spendable_product
                        ) AS spendable_product,
                        (
                            SELECT COALESCE(
                                (SELECT id_brand FROM new_brand),
                                (SELECT id_brand FROM brands WHERE name = $3)
                            ) AS id_brand
                        ) AS brand
                    LIMIT 1
                    RETURNING id_spendable_item
            )
            INSERT INTO public.spendable_stocks
                ( id_spendable_item, id_storage )
                SELECT id_spendable_item, $6
                FROM new_spendable_item
                RETURNING id_spendable_stock;
            `, [ code, description, brand , cost, price, storage, measure, min_stock, mid_stock, max_stock, supplier, manufacture ]
        );
        let data = spendable_items[0]
        res.json({
            success:"Artículo ingresado al inventario",
            data
        });
    }