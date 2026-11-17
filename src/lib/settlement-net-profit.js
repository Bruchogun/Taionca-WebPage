import { units, money } from './money';

export function netCompanyProfit(part, supplements = []) {
    const commissions = (part.commissions || []).reduce((sum, entry) => sum + units(entry.profit), BigInt(0));
    const corrections = supplements.filter(entry => entry.id_part === part.id_part && entry.currency === part.code)
        .reduce((sum, entry) => sum + units(entry.amount), BigInt(0));
    return money(units(part.gross_profit) - commissions - corrections);
}
