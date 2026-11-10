'use strict';
// A Square Cloud não executa etapa de build própria. O postinstall faz o bundle.
const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['live/client-source.js'],bundle:true,platform:'browser',format:'iife',target:['chrome109','firefox115','safari16'],outfile:'live/public/client.js',minify:true,logLevel:'warning'});
console.log('GameDeals Activity compilada com Embedded App SDK.');
