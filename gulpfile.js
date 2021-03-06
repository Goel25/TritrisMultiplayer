//Modified From https://gist.github.com/lukin0110/47d75c7defad0bf413ab
import gulp from 'gulp';
import browserify from 'browserify';
import babelify from 'babelify';
import source from 'vinyl-source-stream';
import uglify from 'gulp-uglify';
import buffer from 'vinyl-buffer';

/**
 * Build an output file. Babelify is used to transform 'jsx' code to JavaScript code.
 **/
gulp.task('build', function () {
    const options = {
        entries: './client/components/app.js', // Entry point
        extensions: ['.js'], // consider files with these extensions as modules
        debug: true
    };

    return browserify(options)
        .transform(babelify)
        .bundle()
        .pipe(source('dev.js'))
        .pipe(gulp.dest('./build'));
});

gulp.task('build-prod', () => {
    const options = {
        entries: './client/components/app.js', // Entry point
        extensions: ['.js'], // consider files with these extensions as modules
    };

    return browserify(options)
        .transform(babelify)
        .bundle()
        .pipe(source('prod.js'))
        .pipe(buffer())
        .pipe(uglify())
        .pipe(gulp.dest('./build'));
});
