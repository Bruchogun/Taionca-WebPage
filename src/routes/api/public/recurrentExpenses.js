export const get = (req,res) => {
    res.statusCode=410;
    res.json({error:'Esta operación antigua no está disponible.',redirect:'/gasto_admin'});
};
