const bcrypt = require('bcrypt');

const saltRounds = 10;

/**
 * Hash a plain text password
 */
const hashPassword = async (password) => {
    return await bcrypt.hash(password, saltRounds);
};

/**
 * Compare a plain text password with a hash
 */
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

module.exports = {
    hashPassword,
    comparePassword
};
