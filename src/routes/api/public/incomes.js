export const post = (req,res) => {
    res.statusCode=410;
    res.json({error:'Esta operación antigua no está disponible.',redirect:'/money_incomes'});
};
