import { authorizeApi } from './authorization';

// Compatibility for composed legacy handlers. All authorization comes from the
// shared method/path policy, including custom permissions created by the admin.
export default function checkPermissionsMW() {
    return (req,res,next) => req.authorized ? next() : authorizeApi(req,res,next);
}
