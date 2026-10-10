import sirv from 'sirv';
import polka from 'polka';
import * as sapper from '@sapper/server';
import responseHelpers from './middlewares/responseHelpers';
import sessions from './middlewares/sessions';
import morgan from 'morgan';
import { json } from 'body-parser';
import authentication from './middlewares/authentication';
import { authorizeApi,authorizePage,csrf } from './middlewares/authorization';
import logs from './middlewares/logs';
import validateBusinessInput from './middlewares/validateBusinessInput';


const { PORT, NODE_ENV } = process.env;
const dev = NODE_ENV === 'development';

// @ts-ignore
export default polka() // You can also use Express
	.use(
		morgan(dev ? 'dev' : 'combined'),
		sirv('static', { dev }),
		sessions(dev),
        responseHelpers,
        authentication,
	)
	.use('/api',
		json(),
        authorizeApi,
        csrf,
		logs,
		validateBusinessInput,
	)
	.use(
        authorizePage,
		sapper.middleware({
			session: (req) => ({user: req.session.user})
		})
	)
	.listen(PORT, err => {
		if (err) console.log('error', err);
	});
