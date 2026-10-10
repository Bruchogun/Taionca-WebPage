import { get as allItems } from './all_items';
export const get = (req,res) => allItems(req,{json(data) {
    const itemsToList=[];
    for(const type of ['spendable','no_spendable']) for(const item of data[type+'_stocks']) itemsToList.push({
        id:type+'-'+item['id_'+type+'_stock'],code:item[type+'_products_code'],description:item.description,
        amount:item[type+'_stocks_amount'],price_sell:item.price,price_cost:item.cost,id_storage:item.id_storage
    });
    res.json({itemsToList});
}});
