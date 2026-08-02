exports.up = (pgm) => {
    pgm.addColumn('profiles', {
        proxy_rotate_url: { type: 'text' }
    });
};

exports.down = (pgm) => {
    pgm.dropColumn('profiles', 'proxy_rotate_url');
};
