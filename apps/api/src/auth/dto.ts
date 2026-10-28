import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { normalizeEmail } from './security';
export class EmailDto {
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? normalizeEmail(value) : value)
  @IsEmail() @Length(3,254) email!: string;
}
export class LoginDto extends EmailDto {
  @ApiProperty() @IsString() @Length(1,128) password!: string;
}
export class RegisterDto extends EmailDto {
  @ApiProperty() @IsString() @Length(12,128) password!: string;
  @ApiProperty() @IsString() @Length(1,100) @Matches(/\S/) displayName!: string;
  @ApiProperty() @IsString() @Length(1,120) @Matches(/\S/) companyName!: string;
}
export class ResetDto {
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @ApiProperty() @IsString() @Length(12,128) password!: string;
}
