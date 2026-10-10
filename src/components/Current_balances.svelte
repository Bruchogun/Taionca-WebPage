<script>

	import { apiFetch } from "../functions";
	import { onMount } from "svelte";
	
	let balances;
	let accountsByCurrency;
	let currencyOrder = [];

	onMount(async () => {
		({balances} = await apiFetch(`/api/public/balances/`));
		balances = sumBalancesByAccount(balances);
	});

		// Function to sum balances by account ID
	function sumBalancesByAccount(dataArray) {
		// Use reduce to group and sum balances
		const accountSums = dataArray.reduce((acc, item) => {
			const accountId = item.id_account;
			const balance = parseFloat(item.balance);
			
			// If account doesn't exist in accumulator, create it
			if (!acc[accountId]) {
				acc[accountId] = {
					id_account: accountId,
					name: item.name,
					currency_symbol: item.symbol,
					currency_code: (item.code || '').toUpperCase(),
					total_balance: 0,
					balance_count: 0
				};
			}
			
			// Add balance to total
			acc[accountId].total_balance += balance;
			acc[accountId].balance_count += 1;
			
			return acc;
		}, {});
		
		// Convert object to array
		return Object.values(accountSums);
	}

	// Function to format numbers based on currency
	function formatBalance(balance, currencyCode) {
	if (currencyCode === 'BTC') {
		return balance.toFixed(8); // Bitcoin uses 8 decimal places
	} else if (currencyCode === 'COP') {
		return new Intl.NumberFormat('es-CO', { 
		minimumFractionDigits: 0,
		maximumFractionDigits: 0 
		}).format(balance);
	} else {
		return new Intl.NumberFormat('en-US', { 
		minimumFractionDigits: 2,
		maximumFractionDigits: 2 
		}).format(balance);
	}
	}

	// Group accounts by currency for better organization
	$: if (balances) {
		accountsByCurrency = balances.reduce((acc, account) => {
		if (!acc[account.currency_code]) {
			acc[account.currency_code] = [];
		}
		acc[account.currency_code].push(account);
		return acc;
		}, {});

		currencyOrder = [...new Set(['USD', 'VES', 'COP', 'EUR', 'BTC', ...Object.keys(accountsByCurrency)])];

		// Sort accounts within each currency: non-zero balances first, then zero balances
		Object.keys(accountsByCurrency).forEach(currency => {
			accountsByCurrency[currency].sort((a, b) => {
				// If one has balance and other doesn't, prioritize the one with balance
				if (a.total_balance > 0 && b.total_balance === 0) return -1;
				if (a.total_balance === 0 && b.total_balance > 0) return 1;
				
				// If both have balance or both are zero, sort by balance amount (descending)
				return b.total_balance - a.total_balance;
			});
		});
	}


</script>

<div class="accounts-table-container">
  <div class="table-wrapper">
    <table class="accounts-table">
      <thead>
        <tr>
          <th>Cuenta</th>
          <th>Moneda</th>
          <th class="text-right">Saldo Total</th>
        </tr>
      </thead>
      <tbody>
        {#each currencyOrder as currency}
          {#if accountsByCurrency[currency]}
            {#each accountsByCurrency[currency] as account}
              <tr class="account-row" class:zero-balance={account.total_balance === 0}>
                <td class="account-name">{account.name}</td>
                <td class="currency">
                  <span class="currency-symbol">{account.currency_symbol}</span>
                  <span class="currency-code">{account.currency_code}</span>
                </td>
                <td class="balance text-right">
                  <span class="currency-symbol">{account.currency_symbol}</span>
                  <span class="amount">{formatBalance(account.total_balance, account.currency_code)}</span>
                </td>
              </tr>
            {/each}
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .accounts-table-container {
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    margin: 20px 0;
  }

  .table-wrapper {
    overflow-x: auto;
  }

  .accounts-table {
    width: 100%;
    border-collapse: collapse;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
  }

  .accounts-table thead {
    background-color: #f8f9fa;
    border-bottom: 2px solid #e9ecef;
  }

  .accounts-table th {
    padding: 12px 16px;
    text-align: left;
    font-weight: 600;
    color: #495057;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .accounts-table td {
    padding: 12px 16px;
    border-bottom: 1px solid #e9ecef;
    vertical-align: middle;
  }

  .account-row:hover {
    background-color: #f8f9fa;
  }

  .account-row.zero-balance {
    opacity: 0.6;
  }

  .account-name {
    font-weight: 500;
    color: #212529;
  }

  .currency {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .currency-symbol {
    font-weight: 600;
    font-size: 16px;
  }

  .currency-code {
    background-color: #e9ecef;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #6c757d;
  }

  .balance {
    font-weight: 600;
    color: #212529;
  }

  .balance .amount {
    margin-left: 4px;
  }

  .text-right {
    text-align: right;
  }

  /* Responsive design */
  @media (max-width: 768px) {
    .accounts-table {
      font-size: 12px;
    }
    
    .accounts-table th,
    .accounts-table td {
      padding: 8px 12px;
    }
    
    .currency {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }
  }

  @media (max-width: 480px) {
    .accounts-table th,
    .accounts-table td {
      padding: 6px 8px;
    }
  }
</style>