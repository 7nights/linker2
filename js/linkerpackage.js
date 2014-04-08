var 
  settings = require('./settings'),
  md5      = require('./utils').md5;
/**
 * the header of a linker package
 */
function PackageHead(buf){
  if(!(buf instanceof Buffer)){
    this.buf = new Buffer(buf);
  } else {
    this.buf = buf || new Buffer(0);
  }
}
PackageHead.create = function(type, fromId, toId, dataLength, dataMD5, sharedSecret){
  if (arguments.length === 1) return new PackageHead(type);
  if(typeof data === "string"){
    data = new Buffer(data);
  }
  sharedSecret = new Buffer((sharedSecret || settings.get('password')) + '');
  var buf = new Buffer(9);
  buf.writeUInt8(type, 0);
  buf.writeUInt32LE(fromId, 1);
  buf.writeUInt32LE(toId, 5);

  var md5buf;
  if(dataLength === 0){
    md5buf = Buffer.concat([buf.slice(1, 9), sharedSecret]);
  } else {
    md5buf = Buffer.concat([buf.slice(1, 9), dataMD5, sharedSecret]);
  }
  md5buf = md5(md5buf);
  buf = Buffer.concat([buf, md5buf]);

  var helper = new Buffer(4);
  helper.writeUInt32LE(dataLength, 0);
  return new PackageHead(Buffer.concat([buf, helper]));
};
PackageHead.prototype = {
  get type() {
    return this.buf.readUInt8(0);
  },
  get fromId(){
    return this.buf.readUInt32LE(1);
  },
  get toId() {
    return this.buf.readUInt32LE(5);
  },
  get hash() {
    return this.buf.slice(9, 25);
  },
  get dataLength() {
    return this.buf.readUInt32LE(25);
  },
  get buffer() {
    return this.buf;
  },
  get verify(dataMD5) {
    var helper = new Buffer(8);
    helper.writeUInt32LE(this.fromId, 0);
    helper.writeUInt32LE(this.toId, 4);
    if(this.dataLength === 0){
      return this.hash.toString('hex') == md5(Buffer.concat([helper, settings.get('password')])).toString('hex');
    }
    return this.hash.toString('hex') == md5(Buffer.concat([helper, dataMD5, settings.get('password')])).toString('hex');
  }
};

/**
 * linker package
 * @param {PackageHead} head
 * @param {Buffer} body
 */
function Package(head, body) {
  this.head = head;
  this.body = body;
}

exports.Package = Package;
exports.PackageHead = PackageHead;