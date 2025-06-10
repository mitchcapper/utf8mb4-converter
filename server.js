// Copyright (c) 2016, David M. Lee, II
// Use the compiled file if it exists, otherwise register Babel and use the source file
try {
  require('./lib/cli');
} catch (error) {
  require('@babel/register')({
    extensions: ['.js'],
    retainLines: typeof v8debug !== 'undefined',
  });
  require('./src/cli');
}
