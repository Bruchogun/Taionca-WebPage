import { compareMoney, displayMoney } from './money';

export const amountColumn = {
    key: 'amount',
    display: ({ value, currency, symbol }) => {
        const amount = displayMoney(value, currency || symbol);
        return symbol ? amount + ' ' + symbol : amount;
    },
    sort: (a, b) => compareMoney(a.value, b.value)
};
