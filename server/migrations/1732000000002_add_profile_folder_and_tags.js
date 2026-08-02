exports.up = (pgm) => {
    pgm.addColumns('profiles', {
        folder: { type: 'text' },
        tags: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") }
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('profiles', ['folder', 'tags']);
};
