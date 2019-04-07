const gzipSize = require('gzip-size')
const chalk = require('chalk')
const path = require('path')
const fs = require('fs-extra')
const prettyBytes = require('pretty-bytes')

const NAME = 'WebpackSizePlugin'

export default class WebpackSizePlugin {
	pattern: RegExp
	jsonFile: string

	constructor (public options: {
		pattern?: RegExp
		jsonFile: string
		stripHash?: (name: string) => string
	}) {
		this.pattern = options.pattern || /\.(mjs|js|css|html)$/
		this.jsonFile = options.jsonFile
		fs.ensureDirSync(path.dirname(this.jsonFile))
	}

	stripHash(name: string) {
		if (this.options.stripHash) return this.options.stripHash(name)
		return name.replace(/([a-z0-9]+)(\.\w+)$/, (raw: string, hash: string, ext: string) => {
			if (hash + ext === name) return raw
			return '*'.repeat(hash.length) + ext
		})
	}

	async apply(compiler) {
		const afterEmit = (compilation, callback) => {
			this.outputSizes(compilation.assets).then(output => {
				if (output) {
					process.nextTick(() => {
						console.log('\n' + output)
					})
				}
			}).catch(console.error).then(callback)
		}

		// for webpack version > 4
		if (compiler.hooks && compiler.hooks.emit) {
			compiler.hooks.emit.tapAsync(NAME, afterEmit)
		}
		else {
			// for webpack version < 3
			compiler.plugin('after-emit', afterEmit)
		}
	}

	async outputSizes (assets) {
		const sizesBefore = await this.getBeforeSizes()
		const sizes = await this.getSizes(assets)
		fs.writeJSONSync(this.options.jsonFile, sizes)

		// get a list of unique filenames
		const files = Object.keys(sizes)
		const width = Math.max(...files.map(file => file.length))

		let output = ''
		const items = []
		for (const name of files) {
			const size = sizes[name] || 0
			const sizeBefore = sizesBefore[name] || 0
			const delta = size - sizeBefore
			const msg = new Array(width - name.length + 2).join(' ') + name + ' ⏤  '
			const color = size > 100 * 1024 ? 'red' : size > 40 * 1024 ? 'yellow' : size > 20 * 1024 ? 'cyan' : 'green'
			let sizeText = chalk[color](prettyBytes(size))
			let deltaText = ''
			if (delta && Math.abs(delta) > 1) {
				deltaText = (delta > 0 ? '+' : '') + prettyBytes(delta)
				if (delta > 1024) {
					sizeText = chalk.bold(sizeText)
					deltaText = chalk.red(deltaText)
				}
				else if (delta < -10) {
					deltaText = chalk.green(deltaText)
				}
				sizeText += ` (${deltaText})`
			}
			let text = msg + sizeText + '\n'
			const item = { name, sizeBefore, size, sizeText, delta, deltaText, msg, color }
			items.push(item)
			output += text
		}
		return output
	}

	async getBeforeSizes() {
		try {
			return fs.readJSONSync(this.jsonFile)
		} catch (e) {
			return {}
		}
	}
	async getSizes (assets: any) {
		const names = Object.keys(assets).filter(k => this.pattern.test(k))
		const sizes = await Promise.all(names.map(n => gzipSize(assets[n].source())))

		const res: {[key: string]: number} = {}
		names.forEach((n, i) => {
			res[this.stripHash(n)] = sizes[i]
		})

		return res
	}
}
